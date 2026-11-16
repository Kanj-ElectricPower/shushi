import { addDays, addMonths, dateInMonth, monthOf } from './dates';
import { shiftToBusinessDay, type BusinessDayShift } from './holidays';
import type { Account, Tx } from './types';

/** この記録が口座残高をいくら動かすか。 */
export function txEffect(tx: Tx, accountId: string): number {
  if (tx.beforeStart) return 0;
  switch (tx.kind) {
    case 'expense':
      return tx.accountId === accountId ? -tx.amount : 0;
    case 'income':
    case 'adjustment':
      return tx.accountId === accountId ? tx.amount : 0;
    case 'transfer':
      return (tx.toAccountId === accountId ? tx.amount : 0) - (tx.accountId === accountId ? tx.amount : 0);
  }
}

/** 口座残高。カードは未払い額がマイナスで返る。 */
export function accountBalance(account: Account, txs: Tx[]): number {
  return txs.reduce((sum, tx) => sum + txEffect(tx, account.id), account.openingBalance);
}

export const cardUnpaid = (card: Account, txs: Tx[]) => -accountBalance(card, txs);

/** 現金は残高を追わない。 */
export const tracksBalance = (account: Account) => account.type !== 'cash';

export interface CardStatement {
  cardId: string;
  /** 締め日 */
  closingDate: string;
  /** 約定の引落日(例: 翌月4日)。引落の記録との対応づけに使う */
  dueDate: string;
  /** 実際の引落日(土日祝・年末年始なら営業日にずらした日) */
  paymentDate: string;
  /** 対象期間の利用額 */
  amount: number;
  /** 引落(振替)を記録済みか */
  paid: boolean;
  /** スキップ済みか */
  skipped: boolean;
}

export const cardRecurringId = (cardId: string) => `card:${cardId}`;

/**
 * カードの締め期間ごとの利用額。締め日・引落日が未設定なら空。
 * 利用のあった最初の月から、upto を含む締め期間までを返す。
 */
export function cardStatements(card: Account, txs: Tx[], upto: string): CardStatement[] {
  if (card.type !== 'card' || !card.closingDay || !card.paymentDay) return [];
  const closingDay = card.closingDay;
  const offset = card.paymentMonthOffset ?? 1;
  // 引落(銀行→カード)以外でカード残高を動かした記録が利用分
  const charges = txs.filter(
    (tx) => tx.kind !== 'adjustment' && !(tx.kind === 'transfer' && tx.toAccountId === card.id) && txEffect(tx, card.id) !== 0,
  );
  const openingDue = card.openingDue?.filter((d) => d.amount !== 0) ?? [];
  if (charges.length === 0 && openingDue.length === 0) return [];
  const closingOf = (month: string) => {
    const [y, m] = month.split('-').map(Number);
    return dateInMonth(y, m, closingDay);
  };
  // 利用のあった最初の月と、開始時点の未払い分が属する締め月のうち早いほうから数える
  const startMonths = [
    ...charges.map((tx) => monthOf(tx.date)),
    ...openingDue.map((d) => addMonths(monthOf(d.dueDate), -offset)),
  ].sort();
  const result: CardStatement[] = [];
  let month = startMonths[0];
  let prevClosing = closingOf(addMonths(month, -1));
  for (;;) {
    const closingDate = closingOf(month);
    const [y, m] = month.split('-').map(Number);
    const dueDate = dateInMonth(y, m + offset, card.paymentDay);
    const paymentDate = shiftToBusinessDay(dueDate, card.paymentShift ?? 'next');
    // 以前の版で約定日のまま記録した引落も、同じ回として扱う
    const keys = [dueDate, paymentDate];
    const amount = charges
      .filter((tx) => tx.date > prevClosing && tx.date <= closingDate)
      .reduce((sum, tx) => sum - txEffect(tx, card.id), 0) + openingDue.filter((d) => d.dueDate === dueDate).reduce((sum, d) => sum + d.amount, 0);
    const paid = txs.some((tx) => tx.recurringId === cardRecurringId(card.id) && keys.includes(tx.recurringDate ?? ''));
    const skipped = keys.some((k) => card.skipped?.includes(k));
    result.push({ cardId: card.id, closingDate, dueDate, paymentDate, amount, paid, skipped });
    if (closingDate >= upto) break;
    prevClosing = closingDate;
    month = addMonths(month, 1);
  }
  return result;
}

/** 今日以降で最初に来る、未記録の引落予定。 */
export function nextCardPayment(card: Account, txs: Tx[], todayDate: string): CardStatement | undefined {
  return cardStatements(card, txs, todayDate).find(
    (s) => s.paymentDate >= todayDate && !s.paid && s.amount > 0 && !s.skipped,
  );
}

export interface CardSchedule {
  closingDay: number;
  paymentDay: number;
  paymentMonthOffset?: number;
  paymentShift?: BusinessDayShift;
}

export interface UpcomingDue {
  /** 利用期間の初日と締め日 */
  periodStart: string;
  closingDate: string;
  /** 約定の引落日 */
  dueDate: string;
  /** 実際の引落日 */
  paymentDate: string;
}

/**
 * todayDate の時点でまだ引き落とされていない回(締め済みで引落前の回と、利用期間中の回)。
 * 記録開始時点の未払い額を、引落日ごとに入力してもらうために使う。
 */
export function upcomingDues(schedule: CardSchedule, todayDate: string): UpcomingDue[] {
  const offset = schedule.paymentMonthOffset ?? 1;
  const closingOf = (month: string) => {
    const [y, m] = month.split('-').map(Number);
    return dateInMonth(y, m, schedule.closingDay);
  };
  const result: UpcomingDue[] = [];
  const thisMonth = monthOf(todayDate);
  for (let month = addMonths(thisMonth, -(offset + 1)); month <= addMonths(thisMonth, 1); month = addMonths(month, 1)) {
    const closingDate = closingOf(month);
    const periodStart = addDays(closingOf(addMonths(month, -1)), 1);
    const [y, m] = month.split('-').map(Number);
    const dueDate = dateInMonth(y, m + offset, schedule.paymentDay);
    const paymentDate = shiftToBusinessDay(dueDate, schedule.paymentShift ?? 'next');
    if (paymentDate >= todayDate && periodStart <= todayDate) result.push({ periodStart, closingDate, dueDate, paymentDate });
  }
  return result;
}
