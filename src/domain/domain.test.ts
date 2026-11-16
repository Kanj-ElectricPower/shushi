import { describe, expect, it } from 'vitest';
import { parseBackupJson, toBackupJson, toCsv } from './backup';
import { accountBalance, cardRecurringId, cardStatements, cardUnpaid, nextCardPayment } from './balance';
import { isComplete, occurrences, pendingItems } from './recurring';
import { annualIncome, monthSummary, taxableYear, unsettledReimbursables } from './summary';
import type { Account, AppData, IncomeSource, Recurring, Tx } from './types';

const bank: Account = { id: 'bank', name: '銀行', type: 'bank', openingBalance: 100000, order: 0 };
const ic: Account = { id: 'ic', name: 'Suica', type: 'ic', openingBalance: 0, order: 1 };
const nisa: Account = { id: 'nisa', name: 'NISA', type: 'nisa', openingBalance: 0, order: 2 };
const card: Account = {
  id: 'card',
  name: 'カード',
  type: 'card',
  openingBalance: 0,
  order: 3,
  closingDay: 15,
  paymentDay: 10,
  paymentMonthOffset: 1,
  paymentAccountId: 'bank',
  // 日付の計算そのものを確かめるため、休日のずらしは別のテストで扱う
  paymentShift: 'none',
};
const sources: IncomeSource[] = [
  { id: 'tokyu', name: 'バイト', incomeType: 'salary', hasWithholding: false, order: 0 },
  { id: 'ta', name: 'TA', incomeType: 'salary', hasWithholding: true, order: 1 },
  { id: 'spot', name: '副業', incomeType: 'misc', hasWithholding: false, order: 2 },
  { id: 'trip', name: '出張費精算', incomeType: 'reimbursement', hasWithholding: false, order: 3 },
  { id: 'allowance', name: 'お小遣い', incomeType: 'family', hasWithholding: false, order: 4 },
];

let seq = 0;
const tx = (partial: Partial<Tx> & Pick<Tx, 'date' | 'kind' | 'amount' | 'accountId'>): Tx => ({
  id: `t${++seq}`,
  createdAt: seq,
  ...partial,
});

describe('口座残高', () => {
  it('支出・収入・振替・調整を反映する', () => {
    const txs = [
      tx({ date: '2026-11-01', kind: 'income', amount: 30000, accountId: 'bank' }),
      tx({ date: '2026-11-02', kind: 'expense', amount: 1200, accountId: 'bank' }),
      tx({ date: '2026-11-03', kind: 'transfer', amount: 3000, accountId: 'bank', toAccountId: 'ic' }),
      tx({ date: '2026-11-04', kind: 'expense', amount: 500, accountId: 'ic' }),
      tx({ date: '2026-11-05', kind: 'adjustment', amount: -100, accountId: 'bank' }),
    ];
    expect(accountBalance(bank, txs)).toBe(100000 + 30000 - 1200 - 3000 - 100);
    expect(accountBalance(ic, txs)).toBe(2500);
  });
});

describe('クレジットカード', () => {
  const txs = [
    tx({ date: '2026-10-20', kind: 'expense', amount: 4000, accountId: 'card', categoryId: 'food' }),
    tx({ date: '2026-11-15', kind: 'expense', amount: 6000, accountId: 'card', categoryId: 'food' }),
    tx({ date: '2026-11-16', kind: 'expense', amount: 900, accountId: 'card', categoryId: 'food' }),
    tx({ date: '2026-11-16', kind: 'transfer', amount: 2000, accountId: 'card', toAccountId: 'ic' }),
  ];

  it('締め期間ごとに利用額をまとめ、引落日を求める', () => {
    const statements = cardStatements(card, txs, '2026-11-20');
    expect(statements.map((s) => [s.closingDate, s.paymentDate, s.amount])).toEqual([
      ['2026-10-15', '2026-11-10', 0],
      ['2026-11-15', '2026-12-10', 10000],
      ['2026-12-15', '2027-01-10', 2900],
    ]);
    expect(nextCardPayment(card, txs, '2026-11-20')?.amount).toBe(10000);
  });

  it('月末締め・翌々月払いを扱える', () => {
    const monthEnd: Account = { ...card, closingDay: 31, paymentDay: 4, paymentMonthOffset: 2 };
    const s = cardStatements(monthEnd, [tx({ date: '2027-02-28', kind: 'expense', amount: 100, accountId: 'card' })], '2027-02-28');
    expect(s.map((x) => [x.closingDate, x.paymentDate])).toEqual([['2027-02-28', '2027-04-04']]);
  });

  it('引落は振替なので支出を二重計上せず、未払いが消える', () => {
    const payment = tx({
      date: '2026-12-10',
      kind: 'transfer',
      amount: 10000,
      accountId: 'bank',
      toAccountId: 'card',
      recurringId: cardRecurringId('card'),
      recurringDate: '2026-12-10',
    });
    const all = [...txs, payment];
    expect(cardUnpaid(card, txs)).toBe(12900);
    expect(cardUnpaid(card, all)).toBe(2900);
    expect(accountBalance(bank, all)).toBe(90000);
    expect(monthSummary(all, sources, '2026-12').expense).toBe(0);
    expect(monthSummary(all, sources, '2026-11').expense).toBe(6900);
    expect(cardStatements(card, all, '2026-12-10').find((s) => s.paymentDate === '2026-12-10')?.paid).toBe(true);
    expect(nextCardPayment(card, all, '2026-12-10')?.paymentDate).toBe('2027-01-10');
  });

  it('「＋」から手入力した引落も引落済みとして扱い、予定を二重に出さない', () => {
    const manual = tx({ date: '2026-12-11', kind: 'transfer', amount: 10000, accountId: 'bank', toAccountId: 'card' });
    expect(pendingItems([], [card], txs, '2026-12-12').length).toBe(1);
    expect(pendingItems([], [card], [...txs, manual], '2026-12-12')).toEqual([]);
    expect(nextCardPayment(card, [...txs, manual], '2026-12-12')?.paymentDate).toBe('2027-01-10');
    // 引落日から離れた日の振替は、その回の引落とはみなさない
    const far = tx({ date: '2026-11-25', kind: 'transfer', amount: 10000, accountId: 'bank', toAccountId: 'card' });
    expect(pendingItems([], [card], [...txs, far], '2026-12-12').length).toBe(1);
  });
});

describe('月次収支', () => {
  it('振替(NISA積立・チャージ)は収支に入れない', () => {
    const txs = [
      tx({ date: '2026-11-05', kind: 'transfer', amount: 10000, accountId: 'bank', toAccountId: 'nisa' }),
      tx({ date: '2026-11-06', kind: 'transfer', amount: 3000, accountId: 'bank', toAccountId: 'ic' }),
    ];
    const s = monthSummary(txs, sources, '2026-11');
    expect([s.income, s.expense, s.net]).toEqual([0, 0, 0]);
    expect(accountBalance(nisa, txs)).toBe(10000);
  });

  it('カテゴリ別・目的タグ別に集計する', () => {
    const txs = [
      tx({ date: '2026-11-01', kind: 'expense', amount: 1000, accountId: 'bank', categoryId: 'food', tagId: 'social' }),
      tx({ date: '2026-11-02', kind: 'expense', amount: 500, accountId: 'bank', categoryId: 'food', tagId: 'normal' }),
      tx({ date: '2026-11-03', kind: 'expense', amount: 300, accountId: 'ic', categoryId: 'transit', tagId: 'social' }),
      tx({ date: '2026-12-01', kind: 'expense', amount: 9999, accountId: 'bank', categoryId: 'food', tagId: 'social' }),
      tx({ date: '2026-11-20', kind: 'income', amount: 10000, accountId: 'bank', incomeSourceId: 'allowance' }),
    ];
    const s = monthSummary(txs, sources, '2026-11');
    expect(Object.fromEntries(s.byCategory)).toEqual({ food: 1500, transit: 300 });
    expect(Object.fromEntries(s.byTag)).toEqual({ social: 1300, normal: 500 });
    expect(s.net).toBe(10000 - 1800);
  });

  it('立替と精算は除外し、差額だけ精算月に残す', () => {
    const income = tx({ date: '2026-12-05', kind: 'income', amount: 15000, accountId: 'bank', incomeSourceId: 'trip' });
    const txs = [
      tx({ date: '2026-11-10', kind: 'expense', amount: 12000, accountId: 'card', reimbursable: true, settledByTxId: income.id }),
      tx({ date: '2026-11-11', kind: 'expense', amount: 2000, accountId: 'ic', reimbursable: true, settledByTxId: income.id }),
      tx({ date: '2026-11-12', kind: 'expense', amount: 800, accountId: 'ic', reimbursable: true }),
      income,
    ];
    expect(monthSummary(txs, sources, '2026-11').net).toBe(0);
    const dec = monthSummary(txs, sources, '2026-12');
    expect([dec.income, dec.reimbursementDiff, dec.net]).toEqual([0, 1000, 1000]);
    expect(unsettledReimbursables(txs).map((t) => t.amount)).toEqual([800]);
  });

  it('不明金の調整を収支に含める', () => {
    const s = monthSummary([tx({ date: '2026-11-30', kind: 'adjustment', amount: -350, accountId: 'bank' })], sources, '2026-11');
    expect([s.adjustment, s.net]).toEqual([-350, -350]);
  });
});

describe('年間所得', () => {
  it('収入源別・所得区分別に額面と源泉徴収額を合計する', () => {
    const txs = [
      tx({ date: '2026-01-25', kind: 'income', amount: 50000, accountId: 'bank', incomeSourceId: 'tokyu' }),
      tx({ date: '2026-02-25', kind: 'income', amount: 9694, accountId: 'bank', incomeSourceId: 'ta', gross: 10000, withholding: 306 }),
      tx({ date: '2026-03-01', kind: 'income', amount: 4000, accountId: 'bank', incomeSourceId: 'spot' }),
      tx({ date: '2025-12-25', kind: 'income', amount: 70000, accountId: 'bank', incomeSourceId: 'tokyu' }),
      tx({ date: '2026-04-01', kind: 'income', amount: 12500, accountId: 'bank', incomeSourceId: 'trip' }),
    ];
    const a = annualIncome(txs, sources, 2026);
    expect(a.rows.map((r) => [r.sourceId, r.gross, r.withholding, r.net])).toEqual([
      ['tokyu', 50000, 0, 50000],
      ['ta', 10000, 306, 9694],
      ['spot', 4000, 0, 4000],
    ]);
    expect(a.byType.get('salary')).toEqual({ gross: 60000, withholding: 306, net: 59694 });
    expect(a.byType.get('misc')?.gross).toBe(4000);
  });
});

describe('定期予定', () => {
  const rec = (partial: Partial<Recurring>): Recurring => ({
    id: 'r',
    name: 'お小遣い',
    freq: 'monthly',
    day: 20,
    startDate: '2026-11-01',
    active: true,
    skipped: [],
    order: 0,
    template: { kind: 'income', amount: 10000, accountId: 'bank', incomeSourceId: 'allowance' },
    ...partial,
  });

  it('毎月・毎週・毎年の予定日を求める', () => {
    expect(occurrences(rec({}), '2027-01-19')).toEqual(['2026-11-20', '2026-12-20']);
    expect(occurrences(rec({ day: 31, startDate: '2027-01-31' }), '2027-03-31')).toEqual(['2027-01-31', '2027-02-28', '2027-03-31']);
    expect(occurrences(rec({ freq: 'weekly', day: 5, startDate: '2026-11-16' }), '2026-11-30')).toEqual(['2026-11-20', '2026-11-27']);
    expect(occurrences(rec({ freq: 'yearly', month: 4, day: 1, startDate: '2026-01-01' }), '2027-12-31')).toEqual(['2026-04-01', '2027-04-01']);
    expect(occurrences(rec({ startDate: '2026-11-21' }), '2026-12-19')).toEqual([]);
  });

  it('確定・スキップした回は未確定に出さない', () => {
    const r = rec({ skipped: ['2026-12-20'] });
    const confirmed = tx({ date: '2026-11-21', kind: 'income', amount: 10000, accountId: 'bank', recurringId: 'r', recurringDate: '2026-11-20' });
    expect(pendingItems([r], [], [], '2027-01-20').map((p) => p.date)).toEqual(['2026-11-20', '2027-01-20']);
    expect(pendingItems([r], [], [confirmed], '2027-01-20').map((p) => p.date)).toEqual(['2027-01-20']);
    expect(pendingItems([rec({ active: false })], [], [], '2027-01-20')).toEqual([]);
  });

  it('カードの引落予定を引落日に出す', () => {
    const txs = [tx({ date: '2026-11-10', kind: 'expense', amount: 5000, accountId: 'card' })];
    expect(pendingItems([], [card], txs, '2026-12-09')).toEqual([]);
    const [item] = pendingItems([], [card], txs, '2026-12-10');
    expect(item.template).toEqual({ kind: 'transfer', amount: 5000, accountId: 'bank', toAccountId: 'card' });
    expect(isComplete(item.template)).toBe(true);
  });

  it('口座が未設定のテンプレートはそのまま確定できない', () => {
    expect(isComplete({ kind: 'transfer', amount: 10000, toAccountId: 'nisa' })).toBe(false);
    expect(isComplete({ kind: 'expense', amount: 980, accountId: 'card', categoryId: 'subs' })).toBe(true);
  });
});

describe('バックアップ', () => {
  const data: AppData = {
    accounts: [bank],
    transactions: [tx({ date: '2026-11-01', kind: 'expense', amount: 1200, accountId: 'bank', categoryId: 'food', memo: 'ランチ, "A"定食' })],
    categories: [{ id: 'food', name: '食費', order: 0 }],
    tags: [],
    incomeSources: sources,
    recurrings: [],
    quickButtons: [],
    incomeWalls: [{ id: 'w', name: '税の壁', amount: 1600000, basis: 'salary', order: 0 }],
  };

  it('書き出したJSONを読み戻せる', () => {
    expect(parseBackupJson(toBackupJson(data, '2026-11-16T00:00:00Z'))).toEqual(data);
  });

  it('別形式のファイルを拒否する', () => {
    expect(() => parseBackupJson('{"foo":1}')).toThrow();
    expect(() => parseBackupJson(JSON.stringify({ app: 'balance-of-payment', version: 1, accounts: [] }))).toThrow();
  });

  it('CSVは名称に変換し、カンマと引用符をエスケープする', () => {
    const lines = toCsv(data).split('\r\n');
    expect(lines[1]).toBe('2026-11-01,支出,1200,銀行,,食費,,,,,,,,"ランチ, ""A""定食"');
  });
});

describe('年間の課税対象収入', () => {
  it('1〜12月に入金された給与・雑所得だけを月別に数える', () => {
    const txs = [
      tx({ date: '2027-01-25', kind: 'income', amount: 50000, accountId: 'bank', incomeSourceId: 'tokyu' }),
      tx({ date: '2027-01-31', kind: 'income', amount: 9694, accountId: 'bank', incomeSourceId: 'ta', gross: 10000, withholding: 306 }),
      tx({ date: '2027-03-10', kind: 'income', amount: 4000, accountId: 'bank', incomeSourceId: 'spot' }),
      tx({ date: '2027-04-20', kind: 'income', amount: 10000, accountId: 'bank', incomeSourceId: 'allowance' }),
      tx({ date: '2027-05-01', kind: 'income', amount: 12500, accountId: 'bank', incomeSourceId: 'trip' }),
      tx({ date: '2027-06-25', kind: 'income', amount: 9694, accountId: 'bank', incomeSourceId: 'ta' }),
      tx({ date: '2026-12-25', kind: 'income', amount: 70000, accountId: 'bank', incomeSourceId: 'tokyu' }),
      tx({ date: '2028-01-05', kind: 'income', amount: 70000, accountId: 'bank', incomeSourceId: 'tokyu' }),
    ];
    const y = taxableYear(txs, sources, 2027);
    expect([y.salary, y.misc, y.taxable, y.withholding]).toEqual([69694, 4000, 73694, 306]);
    expect(y.months[0]).toEqual({ month: 1, salary: 60000, misc: 0 });
    expect(y.months[2]).toEqual({ month: 3, salary: 0, misc: 4000 });
    expect(y.rows.map((r) => [r.sourceId, r.gross])).toEqual([
      ['tokyu', 50000],
      ['ta', 19694],
      ['spot', 4000],
    ]);
    // 源泉徴収ありの TA で額面が未入力の 6 月分
    expect(y.missingGross).toBe(1);
  });
});

describe('古いバックアップ', () => {
  it('年収の壁が無いバックアップも読める', () => {
    const old = { app: 'balance-of-payment', version: 1, accounts: [], transactions: [], categories: [], tags: [], incomeSources: [], recurrings: [], quickButtons: [] };
    expect(parseBackupJson(JSON.stringify(old)).incomeWalls).toEqual([]);
  });
});

describe('記録開始前の収入', () => {
  it('残高と月の収支には入れず、年間の所得にだけ数える', () => {
    const past = tx({ date: '2026-06-25', kind: 'income', amount: 9694, accountId: '', incomeSourceId: 'ta', gross: 10000, withholding: 306, beforeStart: true });
    const now = tx({ date: '2026-11-25', kind: 'income', amount: 50000, accountId: 'bank', incomeSourceId: 'tokyu' });
    const txs = [past, now];
    expect(accountBalance(bank, txs)).toBe(150000);
    expect(monthSummary(txs, sources, '2026-06').income).toBe(0);
    expect(monthSummary(txs, sources, '2026-11').income).toBe(50000);
    const y = taxableYear(txs, sources, 2026);
    expect([y.salary, y.withholding, y.months[5].salary]).toEqual([60000, 306, 10000]);
    expect(annualIncome(txs, sources, 2026).byType.get('salary')?.gross).toBe(60000);
    expect(toCsv({ ...({ accounts: [], categories: [], tags: [], incomeSources: sources, recurrings: [], quickButtons: [], incomeWalls: [] } as unknown as AppData), transactions: [past] }).split('\r\n')[1]).toContain(',開始前,');
  });
});
