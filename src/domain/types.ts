export type AccountType = 'bank' | 'ic' | 'qr' | 'card' | 'nisa' | 'cash';

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  /** 記録開始時点の残高。カードは未払い額をマイナスで持つ。現金は使わない。 */
  openingBalance: number;
  order: number;
  archived?: boolean;
  /** カードのみ: 締め日(1-31、31は月末) */
  closingDay?: number;
  /** カードのみ: 引落日(1-31、31は月末) */
  paymentDay?: number;
  /** カードのみ: 締め月から何か月後に引き落とすか(翌月=1) */
  paymentMonthOffset?: number;
  /** カードのみ: 引落口座 */
  paymentAccountId?: string;
  /** カードのみ: スキップした引落予定日 */
  skipped?: string[];
}

export type TxKind = 'expense' | 'income' | 'transfer' | 'adjustment';

export interface Tx {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  kind: TxKind;
  /** 支出・収入・振替は正の値。調整(不明金)は符号付きで口座残高に加算する。 */
  amount: number;
  /** 支出: 支払元 / 収入: 入金先 / 振替: 移動元 / 調整: 対象口座 */
  accountId: string;
  /** 振替: 移動先 */
  toAccountId?: string;
  categoryId?: string;
  tagId?: string;
  incomeSourceId?: string;
  /** 収入: 額面 */
  gross?: number;
  /** 収入: 源泉徴収額 */
  withholding?: number;
  /** 支出: 立替(後日精算される) */
  reimbursable?: boolean;
  /** 立替支出: 精算した収入の id */
  settledByTxId?: string;
  recurringId?: string;
  /** 定期予定のどの回を確定した記録か */
  recurringDate?: string;
  memo?: string;
  createdAt: number;
}

export interface Category {
  id: string;
  name: string;
  order: number;
}

export interface Tag {
  id: string;
  name: string;
  order: number;
}

/** salary=給与 / misc=雑所得 / family=親からの支給 / reimbursement=立替精算 / other=対象外 */
export type IncomeType = 'salary' | 'misc' | 'family' | 'reimbursement' | 'other';

export interface IncomeSource {
  id: string;
  name: string;
  incomeType: IncomeType;
  hasWithholding: boolean;
  order: number;
}

export interface TxTemplate {
  kind: 'expense' | 'income' | 'transfer';
  amount?: number;
  accountId?: string;
  toAccountId?: string;
  categoryId?: string;
  tagId?: string;
  incomeSourceId?: string;
  memo?: string;
}

export type Freq = 'monthly' | 'weekly' | 'yearly';

export interface Recurring {
  id: string;
  name: string;
  freq: Freq;
  /** monthly/yearly: 日(1-31、31は月末) / weekly: 曜日(0=日) */
  day: number;
  /** yearly: 月(1-12) */
  month?: number;
  /** この日以降の予定だけを出す */
  startDate: string;
  active: boolean;
  template: TxTemplate;
  skipped: string[];
  order: number;
}

export interface QuickButton {
  id: string;
  label: string;
  template: TxTemplate;
  order: number;
}

export interface AppData {
  accounts: Account[];
  transactions: Tx[];
  categories: Category[];
  tags: Tag[];
  incomeSources: IncomeSource[];
  recurrings: Recurring[];
  quickButtons: QuickButton[];
}

export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  bank: '銀行口座',
  ic: '交通系IC',
  qr: 'QR決済',
  card: 'クレジットカード',
  nisa: 'NISA',
  cash: '現金',
};

export const INCOME_TYPE_LABEL: Record<IncomeType, string> = {
  salary: '給与',
  misc: '雑所得',
  family: '親からの支給',
  reimbursement: '立替精算',
  other: '対象外',
};
