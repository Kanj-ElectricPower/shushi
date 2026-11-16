import { describe, expect, it } from 'vitest';
import { cardStatements, cardRecurringId, nextCardPayment, upcomingDues } from './balance';
import { holidaysOf, isBankBusinessDay, shiftToBusinessDay } from './holidays';
import { pendingItems } from './recurring';
import type { Account, Tx } from './types';

describe('日本の祝日', () => {
  it('2026年の祝日(振替休日・国民の休日を含む)', () => {
    expect([...holidaysOf(2026).entries()].sort()).toEqual([
      ['2026-01-01', '元日'],
      ['2026-01-12', '成人の日'],
      ['2026-02-11', '建国記念の日'],
      ['2026-02-23', '天皇誕生日'],
      ['2026-03-20', '春分の日'],
      ['2026-04-29', '昭和の日'],
      ['2026-05-03', '憲法記念日'],
      ['2026-05-04', 'みどりの日'],
      ['2026-05-05', 'こどもの日'],
      ['2026-05-06', '振替休日'],
      ['2026-07-20', '海の日'],
      ['2026-08-11', '山の日'],
      ['2026-09-21', '敬老の日'],
      ['2026-09-22', '国民の休日'],
      ['2026-09-23', '秋分の日'],
      ['2026-10-12', 'スポーツの日'],
      ['2026-11-03', '文化の日'],
      ['2026-11-23', '勤労感謝の日'],
    ]);
  });

  it('2027年の春分・秋分と振替休日', () => {
    const h = holidaysOf(2027);
    expect(h.get('2027-03-21')).toBe('春分の日');
    expect(h.get('2027-03-22')).toBe('振替休日');
    expect(h.get('2027-09-23')).toBe('秋分の日');
  });
});

describe('銀行の営業日', () => {
  it('土日・祝日・年末年始は休み', () => {
    expect(isBankBusinessDay('2026-11-16')).toBe(true); // 月
    expect(isBankBusinessDay('2026-11-21')).toBe(false); // 土
    expect(isBankBusinessDay('2026-11-23')).toBe(false); // 勤労感謝の日
    expect(isBankBusinessDay('2026-12-31')).toBe(false);
    expect(isBankBusinessDay('2027-01-04')).toBe(true);
  });

  it('翌営業日・前営業日にずらす', () => {
    expect(shiftToBusinessDay('2026-10-04', 'next')).toBe('2026-10-05'); // 日 → 月
    expect(shiftToBusinessDay('2026-05-03', 'next')).toBe('2026-05-07'); // 連休明け
    expect(shiftToBusinessDay('2026-05-03', 'prev')).toBe('2026-05-01');
    expect(shiftToBusinessDay('2027-01-01', 'next')).toBe('2027-01-04'); // 年始
    expect(shiftToBusinessDay('2026-10-04', 'none')).toBe('2026-10-04');
    expect(shiftToBusinessDay('2026-11-04', 'next')).toBe('2026-11-04'); // 平日はそのまま
  });
});

describe('カードの引落日(翌月4日・休日は翌営業日)', () => {
  const card: Account = {
    id: 'card',
    name: 'カード',
    type: 'card',
    openingBalance: 0,
    order: 0,
    closingDay: 31,
    paymentDay: 4,
    paymentMonthOffset: 1,
    paymentAccountId: 'bank',
  };
  const txs: Tx[] = [
    { id: 'a', date: '2026-08-20', kind: 'expense', amount: 3000, accountId: 'card', createdAt: 1 },
    { id: 'b', date: '2026-12-10', kind: 'expense', amount: 5000, accountId: 'card', createdAt: 2 },
  ];

  it('休日に当たる月だけ翌営業日にずれる(未設定は翌営業日)', () => {
    const s = cardStatements(card, txs, '2026-12-31');
    expect(s.map((x) => [x.dueDate, x.paymentDate])).toEqual([
      ['2026-09-04', '2026-09-04'], // 金
      ['2026-10-04', '2026-10-05'], // 日 → 月
      ['2026-11-04', '2026-11-04'], // 水
      ['2026-12-04', '2026-12-04'], // 金
      ['2027-01-04', '2027-01-04'], // 月(年始休みの明け)
    ]);
  });

  it('引落日になるまで予定に出さず、確定は約定日で対応づける', () => {
    const rid = cardRecurringId('card');
    const sat: Tx = { id: 's', date: '2027-04-01', kind: 'expense', amount: 800, accountId: 'card', createdAt: 3 };
    // 2027-05-04 は祝日(みどりの日) → 5/6 まで連休のため翌営業日は 5/6
    const all = [...txs, sat];
    expect(nextCardPayment(card, all, '2027-05-01')?.paymentDate).toBe('2027-05-06');
    expect(pendingItems([], [card], all, '2027-05-05').map((p) => p.date)).not.toContain('2027-05-06');
    const [item] = pendingItems([], [card], all, '2027-05-06').filter((p) => p.date === '2027-05-06');
    expect(item.recurringDate).toBe('2027-05-04');
    const paid: Tx = { id: 'p', date: item.date, kind: 'transfer', amount: 800, accountId: 'bank', toAccountId: 'card', recurringId: rid, recurringDate: item.recurringDate, createdAt: 4 };
    expect(pendingItems([], [card], [...all, paid], '2027-05-06').filter((p) => p.recurringDate === '2027-05-04')).toEqual([]);
  });

  it('以前の版で約定日に記録した引落・スキップも同じ回として扱う', () => {
    const rid = cardRecurringId('card');
    const oldPayment: Tx = { id: 'o', date: '2026-10-04', kind: 'transfer', amount: 3000, accountId: 'bank', toAccountId: 'card', recurringId: rid, recurringDate: '2026-10-04', createdAt: 5 };
    expect(cardStatements(card, [...txs, oldPayment], '2026-10-31').find((s) => s.dueDate === '2026-10-04')?.paid).toBe(true);
    const skippedCard = { ...card, skipped: ['2026-10-05'] };
    expect(cardStatements(skippedCard, txs, '2026-10-31').find((s) => s.dueDate === '2026-10-04')?.skipped).toBe(true);
  });
});

describe('記録開始時点の未払い額(引落日ごと)', () => {
  const card: Account = {
    id: 'card',
    name: 'カード',
    type: 'card',
    openingBalance: -28000,
    order: 0,
    closingDay: 15,
    paymentDay: 4,
    paymentMonthOffset: 1,
    paymentAccountId: 'bank',
    openingDue: [
      { dueDate: '2026-12-04', amount: 23000 }, // 締め済み(10/16〜11/15 の利用)
      { dueDate: '2027-01-04', amount: 5000 }, // 利用期間中(11/16〜)
    ],
  };

  it('入力すべき引落の回を出す', () => {
    expect(upcomingDues(card as Required<Pick<Account, 'closingDay' | 'paymentDay'>> & Account, '2026-11-16')).toEqual([
      { periodStart: '2026-10-16', closingDate: '2026-11-15', dueDate: '2026-12-04', paymentDate: '2026-12-04' },
      { periodStart: '2026-11-16', closingDate: '2026-12-15', dueDate: '2027-01-04', paymentDate: '2027-01-04' },
    ]);
    // 引落日の前は、前の回もまだ未払い
    expect(upcomingDues({ closingDay: 15, paymentDay: 26 }, '2026-11-16').map((d) => d.dueDate)).toEqual([
      '2026-11-26',
      '2026-12-26',
      '2027-01-26',
    ]);
  });

  it('記録がなくても、開始時点の未払い分が引落予定額に入る', () => {
    expect(nextCardPayment(card, [], '2026-11-16')?.amount).toBe(23000);
    const use: Tx = { id: 'u', date: '2026-11-20', kind: 'expense', amount: 1200, accountId: 'card', createdAt: 1 };
    const s = cardStatements(card, [use], '2026-12-15');
    expect(s.map((x) => [x.dueDate, x.amount])).toEqual([
      ['2026-12-04', 23000],
      ['2027-01-04', 6200],
    ]);
  });
});
