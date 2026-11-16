import { useState } from 'react';
import { deleteTx, newId, saveTx } from '../db/schema';
import { formatDate, today } from '../domain/dates';
import { unsettledReimbursables } from '../domain/summary';
import type { Account, Tx, TxKind } from '../domain/types';
import { AmountInput } from './AmountInput';
import { Chips, Field, Select, nameOf, parseAmount, toast, useBusy, useData, yen } from './ui';

const KINDS: { id: TxKind; name: string }[] = [
  { id: 'expense', name: '支出' },
  { id: 'income', name: '収入' },
  { id: 'transfer', name: '振替' },
];

const LAST_ACCOUNT_KEY = { expense: 'lastExpenseAccount', income: 'lastIncomeAccount' } as const;

function lastAccount(kind: 'expense' | 'income'): string | undefined {
  try {
    return localStorage.getItem(LAST_ACCOUNT_KEY[kind]) ?? undefined;
  } catch {
    return undefined;
  }
}

function rememberAccount(kind: TxKind, accountId: string) {
  if (kind !== 'expense' && kind !== 'income') return;
  try {
    localStorage.setItem(LAST_ACCOUNT_KEY[kind], accountId);
  } catch {
    // 保存できなくても入力には影響しない
  }
}

export interface EntryFormProps {
  /** 新規入力の初期値(クイックボタン・定期予定) */
  initial?: Partial<Tx>;
  /** 編集する既存の記録 */
  editing?: Tx;
  onDone: () => void;
}

export function EntryForm({ initial, editing, onDone }: EntryFormProps) {
  const data = useData();
  const base: Partial<Tx> = editing ?? initial ?? {};
  const [kind, setKind] = useState<TxKind>(base.kind ?? 'expense');
  const [amount, setAmount] = useState(base.amount !== undefined ? String(base.amount) : '');
  const [date, setDate] = useState(base.date ?? today());
  const [accountByKind, setAccountByKind] = useState<Partial<Record<TxKind, string>>>({
    expense: lastAccount('expense'),
    income: lastAccount('income'),
    ...(base.accountId ? { [base.kind ?? 'expense']: base.accountId } : {}),
  });
  const [selectedTo, setToAccountId] = useState(base.toAccountId);
  const [categoryId, setCategoryId] = useState(base.categoryId);
  const [tagId, setTagId] = useState(base.tagId ?? (editing ? undefined : data.tags[0]?.id));
  const [incomeSourceId, setIncomeSourceId] = useState(base.incomeSourceId);
  const [gross, setGross] = useState(base.gross !== undefined ? String(base.gross) : '');
  const [withholding, setWithholding] = useState(base.withholding !== undefined ? String(base.withholding) : '');
  const [reimbursable, setReimbursable] = useState(base.reimbursable ?? false);
  const [memo, setMemo] = useState(base.memo ?? '');
  const [beforeStart, setBeforeStart] = useState(base.beforeStart ?? false);
  const [settledIds, setSettledIds] = useState<string[]>(() =>
    editing ? data.transactions.filter((t) => t.settledByTxId === editing.id).map((t) => t.id) : [],
  );
  const [error, setError] = useState('');
  const { busy, run } = useBusy();

  const active = (a: Account) => !a.archived || a.id === editing?.accountId || a.id === editing?.toAccountId;
  const accounts = data.accounts.filter(active);
  const accountOptions =
    kind === 'income'
      ? accounts.filter((a) => a.type !== 'card' && a.type !== 'nisa')
      : kind === 'adjustment'
        ? accounts
        : accounts.filter((a) => a.type !== 'nisa');
  const selectedAccount = accountByKind[kind];
  const accountId = accountOptions.some((a) => a.id === selectedAccount) ? selectedAccount : undefined;
  const setAccountId = (id: string) => setAccountByKind((prev) => ({ ...prev, [kind]: id }));
  const toOptions = accounts.filter((a) => a.id !== accountId);
  const toAccountId = toOptions.some((a) => a.id === selectedTo) ? selectedTo : undefined;

  const source = data.incomeSources.find((s) => s.id === incomeSourceId);
  const isReimbursement = kind === 'income' && source?.incomeType === 'reimbursement';
  const showTax = kind === 'income' && (source?.incomeType === 'salary' || source?.incomeType === 'misc');
  // 記録開始前の収入は給与・雑所得だけ(年収の壁の集計用)。入金先は選ばない
  const isBeforeStart = showTax && beforeStart;
  const settleCandidates = isReimbursement
    ? [...unsettledReimbursables(data.transactions), ...data.transactions.filter((t) => editing && t.settledByTxId === editing.id)].sort(
        (a, b) => a.date.localeCompare(b.date),
      )
    : [];
  const settledTotal = settleCandidates.filter((t) => settledIds.includes(t.id)).reduce((sum, t) => sum + t.amount, 0);

  const updateTax = (nextGross: string, nextWithholding: string) => {
    setGross(nextGross);
    setWithholding(nextWithholding);
    const g = parseAmount(nextGross);
    const w = parseAmount(nextWithholding) ?? 0;
    if (g !== undefined && !Number.isNaN(g) && !Number.isNaN(w)) setAmount(String(g - w));
  };

  const submit = async () => {
    const value = parseAmount(amount);
    if (value === undefined || Number.isNaN(value) || (kind === 'adjustment' ? value === 0 : value <= 0)) {
      return setError(kind === 'adjustment' ? '金額を0以外の整数で入力してください' : '金額を1円以上の整数で入力してください');
    }
    if (!date) return setError('日付を入力してください');
    if (!accountId && !isBeforeStart) return setError(kind === 'income' ? '入金先を選んでください' : kind === 'transfer' ? '移動元を選んでください' : '支払元を選んでください');
    if (kind === 'expense' && !categoryId) return setError('カテゴリを選んでください');
    if (kind === 'income' && !incomeSourceId) return setError('収入源を選んでください');
    if (kind === 'transfer' && (!toAccountId || toAccountId === accountId)) return setError('移動元と異なる移動先を選んでください');
    const g = showTax ? parseAmount(gross) : undefined;
    const w = showTax ? parseAmount(withholding) : undefined;
    if (Number.isNaN(g) || Number.isNaN(w) || (g ?? 0) < 0 || (w ?? 0) < 0) return setError('額面・源泉徴収額は0以上の整数で入力してください');

    const tx: Tx = {
      id: editing?.id ?? newId(),
      createdAt: editing?.createdAt ?? Date.now(),
      date,
      kind,
      amount: value,
      accountId: isBeforeStart ? '' : accountId!,
      recurringId: base.recurringId,
      recurringDate: base.recurringDate,
      memo: memo.trim() || undefined,
    };
    if (kind === 'expense') {
      tx.categoryId = categoryId;
      tx.tagId = tagId;
      if (reimbursable) {
        tx.reimbursable = true;
        tx.settledByTxId = editing?.settledByTxId;
      }
    } else if (kind === 'income') {
      tx.incomeSourceId = incomeSourceId;
      tx.gross = g;
      tx.withholding = w;
      if (isBeforeStart) tx.beforeStart = true;
    } else if (kind === 'transfer') {
      tx.toAccountId = toAccountId;
    }
    // 収入なら精算の紐付けを付け直す(立替精算以外に変えたときは外す)
    await saveTx(tx, kind === 'income' ? (isReimbursement ? settledIds : []) : editing?.kind === 'income' ? [] : undefined);
    if (accountId && !isBeforeStart) rememberAccount(kind, accountId);
    toast(editing ? '変更を保存しました' : '記録しました');
    onDone();
  };

  const remove = async () => {
    if (!editing || !window.confirm('この記録を削除しますか？')) return;
    await deleteTx(editing.id);
    toast('削除しました');
    onDone();
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void run(submit);
      }}
    >
      {kind === 'adjustment' ? (
        <div className="notice">残高照合で記録した不明金です。プラスは残高の増加、マイナスは減少を表します。</div>
      ) : (
        <div className="segmented" role="group" aria-label="記録の種類">
          {KINDS.map((k) => (
            <button type="button" key={k.id} aria-pressed={kind === k.id} onClick={() => setKind(k.id)}>
              {k.name}
            </button>
          ))}
        </div>
      )}

      {kind === 'income' && (
        <Field label="収入源">
          <Select value={incomeSourceId} onChange={setIncomeSourceId} options={data.incomeSources} />
        </Field>
      )}

      {showTax && (
        <div className="grid2">
          <Field label="額面(任意)">
            <AmountInput value={gross} onChange={(v) => updateTax(v, withholding)} />
          </Field>
          <Field label="源泉徴収額(任意)">
            <AmountInput value={withholding} onChange={(v) => updateTax(gross, v)} />
          </Field>
        </div>
      )}

      <Field label={kind === 'income' ? (showTax ? '手取り額(入金額)' : '金額(入金額)') : '金額'}>
        <AmountInput
          className="amount"
          value={amount}
          onChange={setAmount}
          allowNegative={kind === 'adjustment'}
          placeholder="0"
          autoFocus={!editing && base.amount === undefined}
        />
      </Field>

      {kind === 'expense' && (
        <>
          <Field label="カテゴリ(何に払ったか)">
            <Chips value={categoryId} onChange={setCategoryId} options={data.categories} />
          </Field>
          <Field label="目的タグ(何のためか)">
            <Chips value={tagId} onChange={setTagId} options={data.tags} />
          </Field>
        </>
      )}

      {showTax && (
        <>
          <label className="check">
            <input type="checkbox" checked={beforeStart} onChange={(e) => setBeforeStart(e.target.checked)} />
            <span>記録開始前の収入(年収の壁の集計用)</span>
          </label>
          {beforeStart && (
            <p className="sub">
              口座残高と月の収支には入れず、「集計 → 年間の所得」にだけ数えます。給与明細ごとでも、数か月分の合計でも入れられます。日付は入金日(合計なら最後の入金日)にしてください。
            </p>
          )}
        </>
      )}

      <div className={kind === 'transfer' ? 'grid2' : undefined} hidden={isBeforeStart}>
        <Field label={kind === 'income' ? '入金先' : kind === 'transfer' ? '移動元' : kind === 'adjustment' ? '口座' : '支払元'}>
          <Select value={accountId} onChange={setAccountId} options={accountOptions} />
        </Field>
        {kind === 'transfer' && (
          <Field label="移動先">
            <Select value={toAccountId} onChange={setToAccountId} options={toOptions} />
          </Field>
        )}
      </div>
      {kind === 'transfer' && (
        <p className="sub">チャージ・ATM引き出し・カードの引き落とし・NISA積立など。収支には計上されません。</p>
      )}

      <Field label="日付">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>

      {kind === 'expense' && (
        <label className="check">
          <input type="checkbox" checked={reimbursable} onChange={(e) => setReimbursable(e.target.checked)} />
          <span>立替(後日、精算される)</span>
        </label>
      )}

      {isReimbursement && (
        <div className="card">
          <div className="sub">この入金で精算される立替を選んでください</div>
          {settleCandidates.length === 0 && <p className="muted">精算待ちの立替はありません。</p>}
          {settleCandidates.map((t) => (
            <label className="check" key={t.id}>
              <input
                type="checkbox"
                checked={settledIds.includes(t.id)}
                onChange={(e) => setSettledIds((ids) => (e.target.checked ? [...ids, t.id] : ids.filter((id) => id !== t.id)))}
              />
              <span>
                {formatDate(t.date)} {nameOf(data.categories, t.categoryId)} {yen(t.amount)}
                {t.memo ? ` ${t.memo}` : ''}
              </span>
            </label>
          ))}
          {settledIds.length > 0 && <div className="sub">選択した立替の合計: {yen(settledTotal)}</div>}
        </div>
      )}

      <Field label="メモ(任意)">
        <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder={kind === 'expense' ? 'ポイント利用分など' : ''} />
      </Field>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        {editing && (
          <button type="button" className="btn danger" onClick={() => void run(remove)} disabled={busy}>
            削除
          </button>
        )}
        <button type="submit" className="btn primary grow" disabled={busy}>
          {busy ? '保存中…' : editing ? '変更を保存' : '記録する'}
        </button>
      </div>
    </form>
  );
}
