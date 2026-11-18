import { cardRecurringId, cardStatements } from './balance';
import { addDays, addMonths, dateInMonth, monthOf, weekdayOf } from './dates';
import type { Account, Recurring, Tx, TxTemplate } from './types';

/** startDate から upto までの予定日(両端含む)。 */
export function occurrences(rec: Recurring, upto: string): string[] {
  const dates: string[] = [];
  if (rec.startDate > upto) return dates;
  if (rec.freq === 'weekly') {
    let date = rec.startDate;
    while (weekdayOf(date) !== rec.day) date = addDays(date, 1);
    for (; date <= upto; date = addDays(date, 7)) dates.push(date);
    return dates;
  }
  for (let month = monthOf(rec.startDate); month <= monthOf(upto); month = addMonths(month, 1)) {
    const [y, m] = month.split('-').map(Number);
    if (rec.freq === 'yearly' && m !== rec.month) continue;
    const date = dateInMonth(y, m, rec.day);
    if (date >= rec.startDate && date <= upto) dates.push(date);
  }
  return dates;
}

export interface PendingItem {
  key: string;
  recurringId: string;
  /** 記録する日(カードは実際の引落日) */
  date: string;
  /** どの回の予定か(定期予定は予定日、カードは約定の引落日) */
  recurringDate: string;
  name: string;
  template: TxTemplate;
  /** カード引落の予定ならそのカード */
  cardId?: string;
}

/**
 * その定期予定で最後に確定した記録の金額。金額が毎回変わる予定(ドル建てのサブスクなど)で、
 * 入力欄の初期値にする。まだ確定したことがなければ undefined。
 */
export function lastRecurringAmount(txs: Tx[], recurringId: string): number | undefined {
  let last: Tx | undefined;
  for (const tx of txs) {
    if (tx.recurringId !== recurringId) continue;
    if (!last || tx.date > last.date || (tx.date === last.date && tx.createdAt > last.createdAt)) last = tx;
  }
  return last?.amount;
}

/** 記録に必要な項目が揃っていて、そのまま確定できるか。 */
export function isComplete(t: TxTemplate): boolean {
  if (!t.amount || t.amount <= 0 || !t.accountId) return false;
  if (t.kind === 'expense') return !!t.categoryId;
  if (t.kind === 'income') return !!t.incomeSourceId;
  return !!t.toAccountId && t.toAccountId !== t.accountId;
}

/** 予定日を過ぎていて、まだ確定もスキップもしていない予定。 */
export function pendingItems(recurrings: Recurring[], accounts: Account[], txs: Tx[], todayDate: string): PendingItem[] {
  const done = new Set(txs.filter((tx) => tx.recurringId).map((tx) => `${tx.recurringId}|${tx.recurringDate}`));
  const items: PendingItem[] = [];
  for (const rec of recurrings) {
    if (!rec.active) continue;
    for (const date of occurrences(rec, todayDate)) {
      if (done.has(`${rec.id}|${date}`) || rec.skipped.includes(date)) continue;
      items.push({ key: `${rec.id}|${date}`, recurringId: rec.id, date, recurringDate: date, name: rec.name, template: rec.template });
    }
  }
  for (const card of accounts) {
    if (card.type !== 'card' || card.archived) continue;
    for (const s of cardStatements(card, txs, todayDate)) {
      if (s.paymentDate > todayDate || s.paid || s.amount <= 0 || s.skipped) continue;
      const recurringId = cardRecurringId(card.id);
      items.push({
        key: `${recurringId}|${s.dueDate}`,
        recurringId,
        date: s.paymentDate,
        recurringDate: s.dueDate,
        name: `${card.name} 引き落とし`,
        cardId: card.id,
        template: { kind: 'transfer', amount: s.amount, accountId: card.paymentAccountId, toAccountId: card.id },
      });
    }
  }
  return items.sort((a, b) => a.date.localeCompare(b.date));
}
