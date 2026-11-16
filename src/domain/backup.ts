import type { AppData, Tx } from './types';

export const BACKUP_VERSION = 2;
/** 後から追加した表。古いバックアップに無ければ空として読む */
const OPTIONAL_TABLES: (keyof AppData)[] = ['incomeWalls'];
const TABLES: (keyof AppData)[] = [
  'accounts',
  'transactions',
  'categories',
  'tags',
  'incomeSources',
  'recurrings',
  'quickButtons',
  'incomeWalls',
];

export function toBackupJson(data: AppData, exportedAt: string): string {
  return JSON.stringify({ app: 'balance-of-payment', version: BACKUP_VERSION, exportedAt, ...data }, null, 2);
}

/** バックアップJSONを検証して読み込む。形式が違えば例外。 */
export function parseBackupJson(text: string): AppData {
  const raw = JSON.parse(text);
  if (raw?.app !== 'balance-of-payment' || typeof raw.version !== 'number') {
    throw new Error('このアプリのバックアップファイルではありません');
  }
  if (raw.version > BACKUP_VERSION) throw new Error('新しいバージョンのバックアップのため読み込めません');
  const data = {} as Record<string, unknown[]>;
  for (const table of TABLES) {
    if (raw[table] === undefined && OPTIONAL_TABLES.includes(table)) {
      data[table] = [];
      continue;
    }
    if (!Array.isArray(raw[table])) throw new Error(`バックアップに ${table} がありません`);
    data[table] = raw[table];
  }
  return data as unknown as AppData;
}

const KIND_LABEL: Record<Tx['kind'], string> = { expense: '支出', income: '収入', transfer: '振替', adjustment: '調整' };

const csvCell = (value: string | number | undefined) => {
  const s = value === undefined ? '' : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** 明細の一覧をCSVにする(Excelで開けるようBOM付き)。 */
export function toCsv(data: AppData): string {
  const name = <T extends { id: string; name: string }>(list: T[]) => {
    const map = new Map(list.map((x) => [x.id, x.name]));
    return (id?: string) => (id ? (map.get(id) ?? '') : '');
  };
  const account = name(data.accounts);
  const category = name(data.categories);
  const tag = name(data.tags);
  const source = name(data.incomeSources);
  const header = ['日付', '種類', '金額', '口座', '振替先', 'カテゴリ', '目的タグ', '収入源', '額面', '源泉徴収額', '立替', '精算済み', 'メモ'];
  const rows = [...data.transactions]
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt)
    .map((tx) => [
      tx.date,
      KIND_LABEL[tx.kind],
      tx.amount,
      account(tx.accountId),
      account(tx.toAccountId),
      category(tx.categoryId),
      tag(tx.tagId),
      source(tx.incomeSourceId),
      tx.gross,
      tx.withholding,
      tx.reimbursable ? '立替' : '',
      tx.reimbursable && tx.settledByTxId ? '済' : '',
      tx.memo,
    ]);
  return '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
