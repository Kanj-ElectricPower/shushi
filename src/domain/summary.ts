import { monthOf } from './dates';
import type { IncomeSource, IncomeType, Tx } from './types';

export interface MonthSummary {
  /** 生活の収入(立替精算の入金を除く) */
  income: number;
  /** 生活の支出(立替分を除く) */
  expense: number;
  /** 残高照合で記録した不明金(プラスは増、マイナスは減) */
  adjustment: number;
  /** 立替精算の差額(精算入金 − 紐付けた立替支出) */
  reimbursementDiff: number;
  net: number;
  byCategory: Map<string, number>;
  byTag: Map<string, number>;
  bySource: Map<string, number>;
}

const add = (map: Map<string, number>, key: string | undefined, value: number) => {
  const k = key ?? '';
  map.set(k, (map.get(k) ?? 0) + value);
};

/**
 * 月の収支。振替(カード引落・チャージ・NISA積立)は計上しない。
 * 立替支出と精算入金は除外し、精算した月に差額だけを計上する。
 */
export function monthSummary(txs: Tx[], sources: IncomeSource[], month: string): MonthSummary {
  const reimbursementSources = new Set(sources.filter((s) => s.incomeType === 'reimbursement').map((s) => s.id));
  const s: MonthSummary = {
    income: 0,
    expense: 0,
    adjustment: 0,
    reimbursementDiff: 0,
    net: 0,
    byCategory: new Map(),
    byTag: new Map(),
    bySource: new Map(),
  };
  for (const tx of txs) {
    if (monthOf(tx.date) !== month) continue;
    if (tx.kind === 'expense') {
      if (tx.reimbursable) continue;
      s.expense += tx.amount;
      add(s.byCategory, tx.categoryId, tx.amount);
      add(s.byTag, tx.tagId, tx.amount);
    } else if (tx.kind === 'income') {
      if (tx.incomeSourceId && reimbursementSources.has(tx.incomeSourceId)) {
        const advanced = txs
          .filter((e) => e.kind === 'expense' && e.settledByTxId === tx.id)
          .reduce((sum, e) => sum + e.amount, 0);
        s.reimbursementDiff += tx.amount - advanced;
      } else {
        s.income += tx.amount;
        add(s.bySource, tx.incomeSourceId, tx.amount);
      }
    } else if (tx.kind === 'adjustment') {
      s.adjustment += tx.amount;
    }
  }
  s.net = s.income - s.expense + s.adjustment + s.reimbursementDiff;
  return s;
}

/** 精算待ちの立替支出。 */
export const unsettledReimbursables = (txs: Tx[]) =>
  txs.filter((tx) => tx.kind === 'expense' && tx.reimbursable && !tx.settledByTxId);

export interface IncomeRow {
  sourceId: string;
  /** 額面(未入力の記録は手取り額で代用) */
  gross: number;
  withholding: number;
  net: number;
  count: number;
}

export interface AnnualIncome {
  rows: IncomeRow[];
  byType: Map<IncomeType, { gross: number; withholding: number; net: number }>;
}

/** 暦年(入金日ベース)の収入源別・所得区分別の集計。立替精算の入金は所得ではないので含めない。 */
export function annualIncome(txs: Tx[], sources: IncomeSource[], year: number): AnnualIncome {
  const typeOf = new Map(sources.map((s) => [s.id, s.incomeType]));
  const rows = new Map<string, IncomeRow>();
  const byType: AnnualIncome['byType'] = new Map();
  for (const tx of txs) {
    if (tx.kind !== 'income' || !tx.date.startsWith(`${year}-`)) continue;
    const sourceId = tx.incomeSourceId ?? '';
    if (typeOf.get(sourceId) === 'reimbursement') continue;
    const gross = tx.gross ?? tx.amount;
    const withholding = tx.withholding ?? 0;
    const row = rows.get(sourceId) ?? { sourceId, gross: 0, withholding: 0, net: 0, count: 0 };
    row.gross += gross;
    row.withholding += withholding;
    row.net += tx.amount;
    row.count += 1;
    rows.set(sourceId, row);
    const type = typeOf.get(sourceId) ?? 'other';
    const t = byType.get(type) ?? { gross: 0, withholding: 0, net: 0 };
    t.gross += gross;
    t.withholding += withholding;
    t.net += tx.amount;
    byType.set(type, t);
  }
  const order = new Map(sources.map((s, i) => [s.id, i]));
  return {
    rows: [...rows.values()].sort((a, b) => (order.get(a.sourceId) ?? 999) - (order.get(b.sourceId) ?? 999)),
    byType,
  };
}
