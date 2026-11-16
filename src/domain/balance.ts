import { dateInMonth, monthOf, addMonths } from './dates';
import type { Account, Tx } from './types';

/** この記録が口座残高をいくら動かすか。 */
export function txEffect(tx: Tx, accountId: string): number {
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
  /** 引落日 */
  paymentDate: string;
  /** 対象期間の利用額 */
  amount: number;
  /** 引落(振替)を記録済みか */
  paid: boolean;
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
  if (charges.length === 0) return [];
  const closingOf = (month: string) => {
    const [y, m] = month.split('-').map(Number);
    return dateInMonth(y, m, closingDay);
  };
  const first = charges.reduce((min, tx) => (tx.date < min ? tx.date : min), charges[0].date);
  const result: CardStatement[] = [];
  let month = monthOf(first);
  let prevClosing = closingOf(addMonths(month, -1));
  for (;;) {
    const closingDate = closingOf(month);
    const [y, m] = month.split('-').map(Number);
    const paymentDate = dateInMonth(y, m + offset, card.paymentDay);
    const amount = charges
      .filter((tx) => tx.date > prevClosing && tx.date <= closingDate)
      .reduce((sum, tx) => sum - txEffect(tx, card.id), 0);
    const paid = txs.some((tx) => tx.recurringId === cardRecurringId(card.id) && tx.recurringDate === paymentDate);
    result.push({ cardId: card.id, closingDate, paymentDate, amount, paid });
    if (closingDate >= upto) break;
    prevClosing = closingDate;
    month = addMonths(month, 1);
  }
  return result;
}

/** 今日以降で最初に来る、未記録の引落予定。 */
export function nextCardPayment(card: Account, txs: Tx[], todayDate: string): CardStatement | undefined {
  return cardStatements(card, txs, todayDate).find(
    (s) => s.paymentDate >= todayDate && !s.paid && s.amount > 0 && !card.skipped?.includes(s.paymentDate),
  );
}
