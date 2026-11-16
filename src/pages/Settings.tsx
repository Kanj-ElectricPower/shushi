import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AmountInput } from '../components/AmountInput';
import {
  Field,
  Select,
  download,
  lastBackupAt,
  markBackup,
  nameOf,
  parseAmount,
  signedYen,
  useBusy,
  useData,
  useScrollTop,
  yen,
} from '../components/ui';
import { db, loadAll, newId, replaceAll, resetAll, saveTx } from '../db/schema';
import { DiagnosticsSection } from './Diagnostics';
import { parseBackupJson, toBackupJson, toCsv } from '../domain/backup';
import { accountBalance, upcomingDues } from '../domain/balance';
import { formatDate, parseYmd, today } from '../domain/dates';
import type { BusinessDayShift } from '../domain/holidays';
import {
  ACCOUNT_TYPE_LABEL,
  INCOME_TYPE_LABEL,
  type Account,
  type AccountType,
  type AppData,
  type Freq,
  type IncomeSource,
  type IncomeType,
  type IncomeWall,
  type WallBasis,
  WALL_BASIS_LABEL,
  type OpeningDue,
  type QuickButton,
  type Recurring,
  type Tx,
  type TxTemplate,
} from '../domain/types';

const SECTIONS: { id: string; name: string; hint: string }[] = [
  { id: 'accounts', name: '口座・カード', hint: '銀行、交通系IC、QR決済、カードの締め日・引落日' },
  { id: 'categories', name: 'カテゴリ', hint: '支出を「何に払ったか」で分ける' },
  { id: 'tags', name: '目的タグ', hint: '支出を「何のためか」で分ける' },
  { id: 'sources', name: '収入源', hint: 'バイト先、所得区分、源泉徴収の有無' },
  { id: 'recurrings', name: '定期予定', hint: 'お小遣い、NISA積立、サブスクなど' },
  { id: 'quick', name: 'クイック入力ボタン', hint: 'ホームに並べるよく使う支出' },
  { id: 'walls', name: '年収の壁', hint: '年間の所得集計で目安にする金額' },
  { id: 'reconcile', name: '残高照合', hint: '実際の残高との差額を確認して調整' },
  { id: 'backup', name: 'バックアップ', hint: '書き出し・読み込み・初期化' },
  { id: 'diagnostics', name: '動作チェック', hint: '保存が終わらないときの診断' },
];

const nextOrder = (list: { order: number }[]) => Math.max(-1, ...list.map((x) => x.order)) + 1;

type TemplateKey = 'accountId' | 'toAccountId' | 'categoryId' | 'tagId' | 'incomeSourceId';

/** 削除した項目を、定期予定とクイックボタンのひな形から外す。 */
async function stripFromTemplates(data: AppData, keys: TemplateKey[], id: string) {
  const strip = (t: TxTemplate): TxTemplate | undefined => {
    if (!keys.some((k) => t[k] === id)) return undefined;
    const next = { ...t };
    for (const k of keys) if (next[k] === id) delete next[k];
    return next;
  };
  for (const r of data.recurrings) {
    const template = strip(r.template);
    if (template) await db.recurrings.put({ ...r, template });
  }
  for (const q of data.quickButtons) {
    const template = strip(q.template);
    if (template) await db.quickButtons.put({ ...q, template });
  }
}

type OrderedTable = 'accounts' | 'categories' | 'tags' | 'incomeSources' | 'recurrings' | 'quickButtons' | 'incomeWalls';

/** index の項目を delta(-1=上, +1=下)だけ動かし、並び順を 0 からの連番で保存し直す。 */
async function moveItem(table: OrderedTable, items: { id: string }[], index: number, delta: number) {
  const target = index + delta;
  if (target < 0 || target >= items.length) return;
  const ids = items.map((x) => x.id);
  [ids[index], ids[target]] = [ids[target], ids[index]];
  await db.transaction('rw', db.table(table), async () => {
    for (const [order, id] of ids.entries()) await db.table(table).update(id, { order });
  });
}

function ListCard<T extends { id: string }>({
  table,
  items,
  label,
  render,
  onSelect,
  empty,
}: {
  table: OrderedTable;
  items: T[];
  /** 並べ替えボタンの読み上げ用の名前 */
  label: (item: T) => string;
  render: (item: T) => ReactNode;
  onSelect: (item: T) => void;
  empty: string;
}) {
  useScrollTop();
  return (
    <div className="card flush">
      {items.length === 0 && (
        <div className="row">
          <span className="muted">{empty}</span>
        </div>
      )}
      {items.map((item, i) => (
        <div className="row tight" key={item.id}>
          <button className="rowmain" onClick={() => onSelect(item)}>
            {render(item)}
          </button>
          {items.length > 1 && (
            <div className="reorder">
              <button
                className="btn small"
                disabled={i === 0}
                aria-label={`${label(item)}を上へ`}
                onClick={() => void moveItem(table, items, i, -1)}
              >
                ↑
              </button>
              <button
                className="btn small"
                disabled={i === items.length - 1}
                aria-label={`${label(item)}を下へ`}
                onClick={() => void moveItem(table, items, i, 1)}
              >
                ↓
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function FormActions({
  onCancel,
  onDelete,
  error,
  busy,
}: {
  onCancel: () => void;
  onDelete?: () => void;
  error: string;
  busy: boolean;
}) {
  useScrollTop();
  return (
    <>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        {onDelete && (
          <button type="button" className="btn danger" onClick={onDelete} disabled={busy}>
            削除
          </button>
        )}
        <button type="button" className="btn" onClick={onCancel}>
          キャンセル
        </button>
        <button type="submit" className="btn primary grow" disabled={busy}>
          {busy ? '保存中…' : '保存'}
        </button>
      </div>
    </>
  );
}

// ---------- 口座・カード ----------

const DAY_OPTIONS = [
  ...Array.from({ length: 30 }, (_, i) => ({ id: String(i + 1), name: `${i + 1}日` })),
  { id: '31', name: '月末' },
];
const SHIFT_OPTIONS = [
  { id: 'next', name: '翌営業日' },
  { id: 'prev', name: '前営業日' },
  { id: 'none', name: 'ずらさない' },
];
const OFFSET_OPTIONS = [
  { id: '0', name: '当月' },
  { id: '1', name: '翌月' },
  { id: '2', name: '翌々月' },
];

function AccountForm({ account, onClose }: { account?: Account; onClose: () => void }) {
  const data = useData();
  const used = !!account && data.transactions.some((t) => t.accountId === account.id || t.toAccountId === account.id);
  const [name, setName] = useState(account?.name ?? '');
  const [type, setType] = useState<AccountType>(account?.type ?? 'bank');
  const [opening, setOpening] = useState(account ? String(type === 'card' ? -account.openingBalance : account.openingBalance) : '0');
  const [closingDay, setClosingDay] = useState(account?.closingDay ? String(account.closingDay) : '');
  const [paymentDay, setPaymentDay] = useState(account?.paymentDay ? String(account.paymentDay) : '');
  const [offset, setOffset] = useState(String(account?.paymentMonthOffset ?? 1));
  const [paymentAccountId, setPaymentAccountId] = useState(account?.paymentAccountId ?? '');
  const [paymentShift, setPaymentShift] = useState<BusinessDayShift>(account?.paymentShift ?? 'next');
  const [archived, setArchived] = useState(account?.archived ?? false);
  const [dueAmounts, setDueAmounts] = useState<Record<string, string>>(() =>
    Object.fromEntries((account?.openingDue ?? []).map((d) => [d.dueDate, String(d.amount)])),
  );
  const [error, setError] = useState('');
  const { busy, run } = useBusy();
  const todayDate = today();
  // 締め日・引落日が決まっていれば、まだ引き落とされていない回ごとに未払い額を入れてもらう
  const dues =
    type === 'card' && closingDay && paymentDay
      ? upcomingDues(
          { closingDay: Number(closingDay), paymentDay: Number(paymentDay), paymentMonthOffset: Number(offset), paymentShift },
          todayDate,
        )
      : [];
  const legacyOpening = account?.type === 'card' && !account.openingDue && account.openingBalance !== 0 ? -account.openingBalance : 0;

  const save = async () => {
    if (!name.trim()) return setError('名前を入力してください');
    if (data.accounts.some((a) => a.name === name.trim() && a.id !== account?.id)) return setError('同じ名前の口座がすでにあります');
    const value = type === 'cash' ? 0 : parseAmount(opening);
    if (value === undefined || Number.isNaN(value)) return setError('金額を整数で入力してください');
    let openingDue: OpeningDue[] | undefined = account?.openingDue;
    let openingBalance = type === 'card' ? -value : value;
    if (dues.length > 0) {
      const entered: OpeningDue[] = [];
      for (const d of dues) {
        const amount = parseAmount(dueAmounts[d.dueDate] ?? '');
        if (amount === undefined) continue;
        if (Number.isNaN(amount) || amount < 0) return setError('未払い額は0以上の整数で入力してください');
        if (amount > 0) entered.push({ dueDate: d.dueDate, amount });
      }
      // 引落済みの過去の回は残す(消すと、記録済みの引落と合わなくなる)。締め日などを変えて合わなくなった未来の回は捨てる
      const kept = (account?.openingDue ?? []).filter((d) => d.dueDate < todayDate && !dues.some((x) => x.dueDate === d.dueDate));
      openingDue = [...kept, ...entered];
      openingBalance = -openingDue.reduce((sum, d) => sum + d.amount, 0);
    }
    const next: Account = {
      id: account?.id ?? newId(),
      order: account?.order ?? nextOrder(data.accounts),
      name: name.trim(),
      type,
      openingBalance,
      archived: archived || undefined,
    };
    if (type === 'card') {
      next.closingDay = closingDay ? Number(closingDay) : undefined;
      next.paymentDay = paymentDay ? Number(paymentDay) : undefined;
      next.paymentMonthOffset = Number(offset);
      next.paymentAccountId = paymentAccountId || undefined;
      next.paymentShift = paymentShift;
      next.skipped = account?.skipped;
      next.openingDue = openingDue;
    }
    await db.accounts.put(next);
    onClose();
  };

  const remove = async () => {
    if (!account) return;
    if (used) return setError('記録で使われている口座は削除できません。「使わなくなった」にチェックして保存すると、入力の選択肢から外せます。');
    if (!window.confirm(`「${account.name}」を削除しますか？`)) return;
    await stripFromTemplates(data, ['accountId', 'toAccountId'], account.id);
    for (const a of data.accounts) {
      if (a.paymentAccountId === account.id) await db.accounts.update(a.id, { paymentAccountId: undefined });
    }
    await db.accounts.delete(account.id);
    onClose();
  };

  return (
    <form
      className="card"
      onSubmit={(e) => {
        e.preventDefault();
        void run(save);
      }}
    >
      <Field label="名前">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例: ○○銀行、Suica、PayPay" />
      </Field>
      <Field label={used ? '種類(記録があるため変更できません)' : '種類'}>
        <select value={type} onChange={(e) => setType(e.target.value as AccountType)} disabled={used}>
          {(Object.keys(ACCOUNT_TYPE_LABEL) as AccountType[]).map((t) => (
            <option key={t} value={t}>
              {ACCOUNT_TYPE_LABEL[t]}
            </option>
          ))}
        </select>
      </Field>
      {type === 'cash' ? (
        <p className="sub">現金は収入・支出だけを記録し、残高は管理しません。</p>
      ) : dues.length > 0 ? null : (
        <Field label={type === 'card' ? '記録開始時点の未払い額' : type === 'nisa' ? '記録開始時点の積立元本' : '記録開始時点の残高'}>
          <AmountInput value={opening} onChange={setOpening} allowNegative />
        </Field>
      )}
      {type === 'card' && (
        <>
          <div className="grid2">
            <Field label="締め日">
              <Select value={closingDay} onChange={setClosingDay} options={DAY_OPTIONS} empty="未設定" />
            </Field>
            <Field label="引落月">
              <Select value={offset} onChange={setOffset} options={OFFSET_OPTIONS} />
            </Field>
            <Field label="引落日">
              <Select value={paymentDay} onChange={setPaymentDay} options={DAY_OPTIONS} empty="未設定" />
            </Field>
            <Field label="引落口座">
              <Select
                value={paymentAccountId}
                onChange={setPaymentAccountId}
                options={data.accounts.filter((a) => a.type === 'bank')}
                empty="未設定"
              />
            </Field>
          </div>
          <Field label="引落日が土日祝・年末年始のとき">
            <Select value={paymentShift} onChange={(v) => setPaymentShift(v as BusinessDayShift)} options={SHIFT_OPTIONS} />
          </Field>
          {dues.length > 0 ? (
            <div className="card">
              <strong>記録を始める前に使った分(まだ引き落とされていない分)</strong>
              <p className="sub">
                カード会社のアプリの「お支払い金額」「ご利用中の金額」を、引落日ごとに入れてください。収支には入らず、未払い額と引落予定額にだけ反映されます。このアプリに記録した利用分は含めないでください。
              </p>
              {legacyOpening > 0 && (
                <div className="notice">以前入力した未払い額 {yen(legacyOpening)} を、引落日ごとに分けて入れ直してください。保存するとこちらの金額に置き換わります。</div>
              )}
              {dues.map((d) => {
                const start = parseYmd(d.periodStart);
                const end = parseYmd(d.closingDate);
                return (
                  <Field
                    key={d.dueDate}
                    label={`${formatDate(d.paymentDate)} 引落分(${start.m}/${start.d}〜${end.m}/${end.d}の利用${d.closingDate >= todayDate ? '・利用期間中' : ''})`}
                  >
                    <AmountInput
                      value={dueAmounts[d.dueDate] ?? ''}
                      onChange={(v) => setDueAmounts((prev) => ({ ...prev, [d.dueDate]: v }))}
                      placeholder="0"
                    />
                  </Field>
                );
              })}
            </div>
          ) : (
            <p className="sub">締め日と引落日を設定すると、次回の引落予定額を計算し、引落日にホームへ確定ボタンを表示します。</p>
          )}
        </>
      )}
      {account && (
        <label className="check">
          <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
          <span>使わなくなった(入力の選択肢とホームから外す)</span>
        </label>
      )}
      <FormActions onCancel={onClose} onDelete={account ? () => void run(remove) : undefined} error={error} busy={busy} />
    </form>
  );
}

function AccountsSection() {
  const data = useData();
  const [editing, setEditing] = useState<Account | 'new' | null>(null);
  if (editing) return <AccountForm account={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />;
  return (
    <>
      <ListCard
        table="accounts"
        label={(a) => a.name}
        items={data.accounts}
        onSelect={setEditing}
        empty="口座がありません。"
        render={(a) => (
          <div className="main">
            <div className="title">
              {a.name}
              {a.archived && <span className="badge">不使用</span>}
            </div>
            <div className="sub">
              {ACCOUNT_TYPE_LABEL[a.type]}
              {a.type === 'card' &&
                (a.closingDay && a.paymentDay
                  ? `・${nameOf(DAY_OPTIONS, String(a.closingDay))}締め ${nameOf(OFFSET_OPTIONS, String(a.paymentMonthOffset ?? 1))}${nameOf(DAY_OPTIONS, String(a.paymentDay))}払い${(a.paymentShift ?? 'next') === 'none' ? '' : `(休日は${nameOf(SHIFT_OPTIONS, a.paymentShift ?? 'next')})`}`
                  : '・締め日と引落日が未設定')}
            </div>
          </div>
        )}
      />
      <button className="btn block" onClick={() => setEditing('new')}>
        ＋ 口座・カードを追加
      </button>
    </>
  );
}

// ---------- カテゴリ・目的タグ ----------

function NameSection({ table }: { table: 'categories' | 'tags' }) {
  const data = useData();
  const items = data[table];
  const txKey = table === 'categories' ? 'categoryId' : 'tagId';
  const label = table === 'categories' ? 'カテゴリ' : '目的タグ';
  const [editing, setEditing] = useState<{ id?: string; name: string } | null>(null);
  const [error, setError] = useState('');
  const { busy, run } = useBusy();

  const close = () => {
    setEditing(null);
    setError('');
  };
  const save = async () => {
    if (!editing) return;
    const name = editing.name.trim();
    if (!name) return setError('名前を入力してください');
    if (items.some((x) => x.name === name && x.id !== editing.id)) return setError('同じ名前がすでにあります');
    const existing = items.find((x) => x.id === editing.id);
    await db[table].put({ id: existing?.id ?? newId(), order: existing?.order ?? nextOrder(items), name });
    close();
  };
  const remove = async () => {
    const id = editing?.id;
    if (!id) return;
    const count = data.transactions.filter((t) => t[txKey] === id).length;
    if (count > 0) return setError(`${count}件の記録で使われているため削除できません。名前の変更はできます。`);
    if (!window.confirm(`「${editing.name}」を削除しますか？`)) return;
    await stripFromTemplates(data, [txKey], id);
    await db[table].delete(id);
    close();
  };

  if (editing) {
    return (
      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          void run(save);
        }}
      >
        <Field label={`${label}の名前`}>
          <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} autoFocus />
        </Field>
        <FormActions onCancel={close} onDelete={editing.id ? () => void run(remove) : undefined} error={error} busy={busy} />
      </form>
    );
  }
  return (
    <>
      <ListCard table={table} label={(x) => x.name} items={items} onSelect={(x) => setEditing({ id: x.id, name: x.name })} empty="まだありません。" render={(x) => <div className="main title">{x.name}</div>} />
      <button className="btn block" onClick={() => setEditing({ name: '' })}>
        ＋ {label}を追加
      </button>
    </>
  );
}

// ---------- 収入源 ----------

function SourceForm({ source, onClose }: { source?: IncomeSource; onClose: () => void }) {
  const data = useData();
  const [name, setName] = useState(source?.name ?? '');
  const [incomeType, setIncomeType] = useState<IncomeType>(source?.incomeType ?? 'salary');
  const [hasWithholding, setHasWithholding] = useState(source?.hasWithholding ?? false);
  const [error, setError] = useState('');
  const { busy, run } = useBusy();

  const save = async () => {
    if (!name.trim()) return setError('名前を入力してください');
    if (data.incomeSources.some((s) => s.name === name.trim() && s.id !== source?.id)) return setError('同じ名前の収入源がすでにあります');
    await db.incomeSources.put({
      id: source?.id ?? newId(),
      order: source?.order ?? nextOrder(data.incomeSources),
      name: name.trim(),
      incomeType,
      hasWithholding,
    });
    onClose();
  };
  const remove = async () => {
    if (!source) return;
    const count = data.transactions.filter((t) => t.incomeSourceId === source.id).length;
    if (count > 0) return setError(`${count}件の記録で使われているため削除できません。`);
    if (!window.confirm(`「${source.name}」を削除しますか？`)) return;
    await stripFromTemplates(data, ['incomeSourceId'], source.id);
    await db.incomeSources.delete(source.id);
    onClose();
  };

  return (
    <form
      className="card"
      onSubmit={(e) => {
        e.preventDefault();
        void run(save);
      }}
    >
      <Field label="名前">
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="区分">
        <select value={incomeType} onChange={(e) => setIncomeType(e.target.value as IncomeType)}>
          {(Object.keys(INCOME_TYPE_LABEL) as IncomeType[]).map((t) => (
            <option key={t} value={t}>
              {INCOME_TYPE_LABEL[t]}
            </option>
          ))}
        </select>
      </Field>
      <p className="sub">
        「給与」「雑所得」は年間の所得集計の対象で、額面と源泉徴収額を入力できます。「立替精算」は出張費など立て替えた分の入金用で、収支から除外されます。
      </p>
      <label className="check">
        <input type="checkbox" checked={hasWithholding} onChange={(e) => setHasWithholding(e.target.checked)} />
        <span>源泉徴収あり</span>
      </label>
      <FormActions onCancel={onClose} onDelete={source ? () => void run(remove) : undefined} error={error} busy={busy} />
    </form>
  );
}

function SourcesSection() {
  const data = useData();
  const [editing, setEditing] = useState<IncomeSource | 'new' | null>(null);
  if (editing) return <SourceForm source={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />;
  return (
    <>
      <ListCard
        table="incomeSources"
        label={(s) => s.name}
        items={data.incomeSources}
        onSelect={setEditing}
        empty="収入源がありません。"
        render={(s) => (
          <div className="main">
            <div className="title">{s.name}</div>
            <div className="sub">
              {INCOME_TYPE_LABEL[s.incomeType]}
              {s.hasWithholding && '・源泉徴収あり'}
            </div>
          </div>
        )}
      />
      <button className="btn block" onClick={() => setEditing('new')}>
        ＋ 収入源を追加
      </button>
    </>
  );
}

// ---------- ひな形(定期予定・クイックボタン共通) ----------

const KIND_OPTIONS = [
  { id: 'expense', name: '支出' },
  { id: 'income', name: '収入' },
  { id: 'transfer', name: '振替' },
];

function TemplateFields({
  value,
  onChange,
  kinds = KIND_OPTIONS,
}: {
  value: TxTemplate;
  onChange: (t: TxTemplate) => void;
  kinds?: typeof KIND_OPTIONS;
}) {
  const data = useData();
  const accounts = data.accounts.filter((a) => !a.archived);
  const set = (patch: Partial<TxTemplate>) => onChange({ ...value, ...patch });
  const fromOptions =
    value.kind === 'income' ? accounts.filter((a) => a.type !== 'card' && a.type !== 'nisa') : accounts.filter((a) => a.type !== 'nisa');
  return (
    <>
      {kinds.length > 1 && (
        <Field label="種類">
          <Select value={value.kind} onChange={(v) => onChange({ kind: v as TxTemplate['kind'], amount: value.amount, memo: value.memo })} options={kinds} />
        </Field>
      )}
      <Field label="金額(毎回変わるなら空欄)">
        <AmountInput
          value={value.amount !== undefined ? String(value.amount) : ''}
          onChange={(v) => set({ amount: v === '' ? undefined : Number(v) })}
        />
      </Field>
      {value.kind === 'expense' && (
        <div className="grid2">
          <Field label="カテゴリ">
            <Select value={value.categoryId} onChange={(v) => set({ categoryId: v || undefined })} options={data.categories} empty="未設定" />
          </Field>
          <Field label="目的タグ">
            <Select value={value.tagId} onChange={(v) => set({ tagId: v || undefined })} options={data.tags} empty="未設定" />
          </Field>
        </div>
      )}
      {value.kind === 'income' && (
        <Field label="収入源">
          <Select value={value.incomeSourceId} onChange={(v) => set({ incomeSourceId: v || undefined })} options={data.incomeSources} empty="未設定" />
        </Field>
      )}
      <Field label={value.kind === 'income' ? '入金先' : value.kind === 'transfer' ? '移動元' : '支払元'}>
        <Select value={value.accountId} onChange={(v) => set({ accountId: v || undefined })} options={fromOptions} empty="未設定(入力時に選ぶ)" />
      </Field>
      {value.kind === 'transfer' && (
        <Field label="移動先">
          <Select
            value={value.toAccountId}
            onChange={(v) => set({ toAccountId: v || undefined })}
            options={accounts.filter((a) => a.id !== value.accountId)}
            empty="未設定"
          />
        </Field>
      )}
      <Field label="メモ(任意)">
        <input value={value.memo ?? ''} onChange={(e) => set({ memo: e.target.value || undefined })} />
      </Field>
    </>
  );
}

function templateSummary(t: TxTemplate, data: AppData): string {
  const what =
    t.kind === 'expense'
      ? nameOf(data.categories, t.categoryId, 'カテゴリ未設定')
      : t.kind === 'income'
        ? nameOf(data.incomeSources, t.incomeSourceId, '収入源未設定')
        : `${nameOf(data.accounts, t.accountId, '口座未設定')} → ${nameOf(data.accounts, t.toAccountId, '口座未設定')}`;
  return [KIND_OPTIONS.find((k) => k.id === t.kind)?.name, what, t.amount ? yen(t.amount) : ''].filter(Boolean).join('・');
}

function validTemplateAmount(t: TxTemplate): boolean {
  return t.amount === undefined || (Number.isInteger(t.amount) && t.amount > 0);
}

// ---------- 定期予定 ----------

const FREQ_OPTIONS = [
  { id: 'monthly', name: '毎月' },
  { id: 'weekly', name: '毎週' },
  { id: 'yearly', name: '毎年' },
];
const WEEKDAY_OPTIONS = ['日', '月', '火', '水', '木', '金', '土'].map((name, i) => ({ id: String(i), name: `${name}曜日` }));
const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => ({ id: String(i + 1), name: `${i + 1}月` }));

function scheduleLabel(r: Recurring): string {
  if (r.freq === 'weekly') return `毎週${nameOf(WEEKDAY_OPTIONS, String(r.day))}`;
  const day = nameOf(DAY_OPTIONS, String(r.day));
  return r.freq === 'yearly' ? `毎年${r.month}月${day}` : `毎月${day}`;
}

function RecurringForm({ rec, onClose }: { rec?: Recurring; onClose: () => void }) {
  const data = useData();
  const [name, setName] = useState(rec?.name ?? '');
  const [freq, setFreq] = useState<Freq>(rec?.freq ?? 'monthly');
  const [day, setDay] = useState(String(rec?.day ?? 1));
  const [month, setMonth] = useState(String(rec?.month ?? 1));
  const [startDate, setStartDate] = useState(rec?.startDate ?? today());
  const [active, setActive] = useState(rec?.active ?? true);
  const [template, setTemplate] = useState<TxTemplate>(rec?.template ?? { kind: 'expense' });
  const [error, setError] = useState('');
  const { busy, run } = useBusy();

  const changeFreq = (next: Freq) => {
    // 曜日(0-6)と日(1-31)は範囲が違うので切り替え時に初期化する
    if ((next === 'weekly') !== (freq === 'weekly')) setDay('1');
    setFreq(next);
  };

  const save = async () => {
    if (!name.trim()) return setError('名前を入力してください');
    if (!startDate) return setError('開始日を入力してください');
    if (!validTemplateAmount(template)) return setError('金額は1円以上の整数で入力するか、空欄にしてください');
    await db.recurrings.put({
      id: rec?.id ?? newId(),
      order: rec?.order ?? nextOrder(data.recurrings),
      name: name.trim(),
      freq,
      day: Number(day),
      month: freq === 'yearly' ? Number(month) : undefined,
      startDate,
      active,
      template,
      skipped: rec?.skipped ?? [],
    });
    onClose();
  };
  const remove = async () => {
    if (!rec || !window.confirm(`定期予定「${rec.name}」を削除しますか？ 確定済みの記録は残ります。`)) return;
    await db.recurrings.delete(rec.id);
    onClose();
  };

  return (
    <form
      className="card"
      onSubmit={(e) => {
        e.preventDefault();
        void run(save);
      }}
    >
      <Field label="名前">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例: 動画サブスク" />
      </Field>
      <div className="grid2">
        <Field label="頻度">
          <Select value={freq} onChange={(v) => changeFreq(v as Freq)} options={FREQ_OPTIONS} />
        </Field>
        {freq === 'yearly' && (
          <Field label="月">
            <Select value={month} onChange={setMonth} options={MONTH_OPTIONS} />
          </Field>
        )}
        <Field label={freq === 'weekly' ? '曜日' : '日'}>
          <Select value={day} onChange={setDay} options={freq === 'weekly' ? WEEKDAY_OPTIONS : DAY_OPTIONS} />
        </Field>
      </div>
      <Field label="開始日(この日以降の予定を表示)">
        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
      </Field>
      <TemplateFields value={template} onChange={setTemplate} />
      <label className="check">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
        <span>有効(予定日にホームへ表示する)</span>
      </label>
      <FormActions onCancel={onClose} onDelete={rec ? () => void run(remove) : undefined} error={error} busy={busy} />
    </form>
  );
}

function RecurringsSection() {
  const data = useData();
  const [editing, setEditing] = useState<Recurring | 'new' | null>(null);
  if (editing) return <RecurringForm rec={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />;
  return (
    <>
      <p className="sub">
        予定日になるとホームに「未確定の予定」として表示され、タップで記録できます。カードの引き落としは「口座・カード」で締め日と引落日を設定すると自動で予定に出ます。
      </p>
      <ListCard
        table="recurrings"
        label={(r) => r.name}
        items={data.recurrings}
        onSelect={setEditing}
        empty="定期予定がありません。"
        render={(r) => (
          <div className="main">
            <div className="title">
              {r.name}
              {!r.active && <span className="badge">停止中</span>}
            </div>
            <div className="sub title">
              {scheduleLabel(r)}・{templateSummary(r.template, data)}
            </div>
          </div>
        )}
      />
      <button className="btn block" onClick={() => setEditing('new')}>
        ＋ 定期予定を追加
      </button>
    </>
  );
}

// ---------- クイック入力ボタン ----------

const EXPENSE_ONLY = KIND_OPTIONS.filter((k) => k.id === 'expense');

function QuickForm({ button, onClose }: { button?: QuickButton; onClose: () => void }) {
  const data = useData();
  const [label, setLabel] = useState(button?.label ?? '');
  const [template, setTemplate] = useState<TxTemplate>(button?.template ?? { kind: 'expense' });
  const [error, setError] = useState('');
  const { busy, run } = useBusy();

  const save = async () => {
    if (!label.trim()) return setError('ボタンの名前を入力してください');
    if (!validTemplateAmount(template)) return setError('金額は1円以上の整数で入力するか、空欄にしてください');
    await db.quickButtons.put({
      id: button?.id ?? newId(),
      order: button?.order ?? nextOrder(data.quickButtons),
      label: label.trim(),
      template,
    });
    onClose();
  };
  const remove = async () => {
    if (!button || !window.confirm(`ボタン「${button.label}」を削除しますか？`)) return;
    await db.quickButtons.delete(button.id);
    onClose();
  };

  return (
    <form
      className="card"
      onSubmit={(e) => {
        e.preventDefault();
        void run(save);
      }}
    >
      <Field label="ボタンの名前">
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="例: 学食" />
      </Field>
      <TemplateFields value={template} onChange={setTemplate} kinds={EXPENSE_ONLY} />
      <FormActions onCancel={onClose} onDelete={button ? () => void run(remove) : undefined} error={error} busy={busy} />
    </form>
  );
}

function QuickSection() {
  const data = useData();
  const [editing, setEditing] = useState<QuickButton | 'new' | null>(null);
  if (editing) return <QuickForm button={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />;
  return (
    <>
      <ListCard
        table="quickButtons"
        label={(q) => q.label}
        items={data.quickButtons}
        onSelect={setEditing}
        empty="ボタンがありません。"
        render={(q) => (
          <div className="main">
            <div className="title">{q.label}</div>
            <div className="sub title">
              {[templateSummary(q.template, data), nameOf(data.tags, q.template.tagId, ''), nameOf(data.accounts, q.template.accountId, '')]
                .filter(Boolean)
                .join('・')}
            </div>
          </div>
        )}
      />
      <button className="btn block" onClick={() => setEditing('new')}>
        ＋ ボタンを追加
      </button>
    </>
  );
}

// ---------- 年収の壁 ----------

const BASIS_OPTIONS = (Object.keys(WALL_BASIS_LABEL) as WallBasis[]).map((id) => ({ id, name: WALL_BASIS_LABEL[id] }));

function WallForm({ wall, onClose }: { wall?: IncomeWall; onClose: () => void }) {
  const data = useData();
  const [name, setName] = useState(wall?.name ?? '');
  const [amount, setAmount] = useState(wall ? String(wall.amount) : '');
  const [basis, setBasis] = useState<WallBasis>(wall?.basis ?? 'salary');
  const [error, setError] = useState('');
  const { busy, run } = useBusy();

  const save = async () => {
    if (!name.trim()) return setError('名前を入力してください');
    const value = parseAmount(amount);
    if (value === undefined || Number.isNaN(value) || value <= 0) return setError('金額を1円以上の整数で入力してください');
    await db.incomeWalls.put({
      id: wall?.id ?? newId(),
      order: wall?.order ?? nextOrder(data.incomeWalls),
      name: name.trim(),
      amount: value,
      basis,
    });
    onClose();
  };
  const remove = async () => {
    if (!wall || !window.confirm(`「${wall.name}」を削除しますか？`)) return;
    await db.incomeWalls.delete(wall.id);
    onClose();
  };

  return (
    <form
      className="card"
      onSubmit={(e) => {
        e.preventDefault();
        void run(save);
      }}
    >
      <Field label="名前">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例: 所得税がかからない上限" />
      </Field>
      <Field label="金額(年間)">
        <AmountInput value={amount} onChange={setAmount} placeholder="0" />
      </Field>
      <Field label="比べる対象">
        <Select value={basis} onChange={(v) => setBasis(v as WallBasis)} options={BASIS_OPTIONS} />
      </Field>
      <p className="sub">
        「給与の額面合計」は収入源の区分が「給与」のものだけ、「給与＋雑所得の合計」は雑所得(SPOTJOBS など)も含めた額と比べます。
      </p>
      <FormActions onCancel={onClose} onDelete={wall ? () => void run(remove) : undefined} error={error} busy={busy} />
    </form>
  );
}

function WallsSection() {
  const data = useData();
  const [editing, setEditing] = useState<IncomeWall | 'new' | null>(null);
  if (editing) return <WallForm wall={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />;
  return (
    <>
      <p className="sub">
        登録した金額と、その年の1〜12月に入金された収入を「集計 → 年間の所得」で比べます。壁の金額は税制改正で変わるため、国税庁などで最新の金額を確かめて登録してください。
      </p>
      <ListCard
        table="incomeWalls"
        label={(w) => w.name}
        items={data.incomeWalls}
        onSelect={setEditing}
        empty="まだ登録されていません。"
        render={(w) => (
          <div className="main">
            <div className="title">{w.name}</div>
            <div className="sub">
              {yen(w.amount)}・{WALL_BASIS_LABEL[w.basis]}と比較
            </div>
          </div>
        )}
      />
      <button className="btn block" onClick={() => setEditing('new')}>
        ＋ 年収の壁を追加
      </button>
    </>
  );
}

// ---------- 残高照合 ----------

function ReconcileRow({ account }: { account: Account }) {
  const data = useData();
  const [actual, setActual] = useState('');
  const [done, setDone] = useState('');
  const { busy, run } = useBusy();
  const isCard = account.type === 'card';
  const balance = accountBalance(account, data.transactions);
  const shown = isCard ? -balance : balance;
  const value = parseAmount(actual);
  const valid = value !== undefined && !Number.isNaN(value);
  // カードは未払い額で入力するので、残高への影響は符号が逆になる
  const diff = valid ? (isCard ? -value : value) - balance : 0;

  const adjust = async () => {
    const tx: Tx = {
      id: newId(),
      createdAt: Date.now(),
      date: today(),
      kind: 'adjustment',
      amount: diff,
      accountId: account.id,
      memo: '残高照合',
    };
    await saveTx(tx);
    setActual('');
    setDone(`${signedYen(diff)} を不明金として記録しました。`);
  };

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <strong>{account.name}</strong>
        <span className="num">
          <span className="sub">アプリ上の{isCard ? '未払い' : '残高'} </span>
          {yen(shown)}
        </span>
      </div>
      <Field label={isCard ? '実際の未払い額(カード会社のアプリ等で確認)' : '実際の残高'}>
        <AmountInput
          value={actual}
          allowNegative
          onChange={(v) => {
            setActual(v);
            setDone('');
          }}
        />
      </Field>
      {valid && diff === 0 && <p className="sub">一致しています。</p>}
      {valid && diff !== 0 && (
        <>
          <p className="num">
            差額: {signedYen(isCard ? -diff : diff)}
            <span className="sub">
              {' '}
              ({diff < 0 ? '記録していない支出' : '記録していない収入'}が {yen(Math.abs(diff))} あります)
            </span>
          </p>
          <button className="btn small" disabled={busy} onClick={() => void run(adjust)}>
            差額を不明金として記録
          </button>
        </>
      )}
      {done && <p className="sub">{done}</p>}
    </div>
  );
}

function ReconcileSection() {
  const data = useData();
  const accounts = data.accounts.filter((a) => !a.archived && (a.type === 'bank' || a.type === 'ic' || a.type === 'qr' || a.type === 'card'));
  return (
    <>
      <p className="sub">
        実際の残高を入力すると、アプリ上の残高との差額が分かります。入力漏れを思い出せたら記録を追加し、分からない分は「不明金」として今日の日付で調整できます(その月の収支に含まれます)。
      </p>
      {accounts.length === 0 && <p className="muted">残高を管理する口座がありません。</p>}
      {accounts.map((a) => (
        <ReconcileRow key={a.id} account={a} />
      ))}
    </>
  );
}

// ---------- バックアップ ----------

function BackupSection() {
  const data = useData();
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [lastBackup, setLastBackup] = useState(lastBackupAt);
  const [persisted, setPersisted] = useState<boolean | undefined>();
  const stamp = today().replace(/-/g, '');
  useEffect(() => {
    void navigator.storage?.persisted?.().then(setPersisted);
  }, []);

  const exportJson = async () => {
    download(`shushi-backup-${stamp}.json`, toBackupJson(await loadAll(), new Date().toISOString()), 'application/json');
    markBackup();
    setLastBackup(lastBackupAt());
    setMessage('バックアップを書き出しました。ダウンロードしたファイルを、Googleドライブなど端末の外にも保管してください。');
  };
  const importJson = async (file: File | undefined) => {
    setError('');
    setMessage('');
    if (!file) return;
    try {
      const next = parseBackupJson(await file.text());
      if (!window.confirm(`現在のデータをすべて消して、バックアップ(記録 ${next.transactions.length} 件)に置き換えますか？`)) return;
      await replaceAll(next);
      setMessage('バックアップを読み込みました。');
    } catch (e) {
      setError(e instanceof Error ? e.message : '読み込みに失敗しました');
    }
  };
  const reset = async () => {
    if (!window.confirm(`記録 ${data.transactions.length} 件と設定をすべて消して初期状態に戻しますか？ 元に戻せません。`)) return;
    await resetAll();
    setMessage('初期状態に戻しました。');
  };

  return (
    <>
      <p className="sub">
        データはこの端末のブラウザ内にだけ保存されています。機種変更やブラウザのデータ削除で失われるため、定期的にバックアップを書き出して保管してください。
      </p>
      <div className="card">
        <p>記録 {data.transactions.length} 件</p>
        <p className="sub">
          前回の書き出し: {lastBackup ? new Date(lastBackup).toLocaleDateString('ja-JP') : 'まだありません'}
          {persisted !== undefined && (persisted ? '・自動削除からの保護: 有効' : '・自動削除からの保護: 無効(ホーム画面に追加すると有効になりやすくなります)')}
        </p>
        <div className="actions">
          <button className="btn" onClick={() => void exportJson()}>
            バックアップを書き出す(JSON)
          </button>
          <button className="btn" onClick={() => download(`shushi-${stamp}.csv`, toCsv(data), 'text/csv')}>
            明細をCSVで書き出す
          </button>
        </div>
      </div>
      <div className="card">
        <Field label="バックアップ(JSON)を読み込む ※現在のデータは置き換えられます">
          <input
            type="file"
            accept="application/json,.json"
            onChange={(e) => {
              void importJson(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </Field>
      </div>
      <div className="card">
        <button className="btn danger" onClick={() => void reset()}>
          すべてのデータを消して初期状態に戻す
        </button>
      </div>
      {message && <p className="sub">{message}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

// ---------- 設定トップ ----------

export function Settings() {
  const { section } = useParams();
  const current = SECTIONS.find((s) => s.id === section);
  if (!current) {
    return (
      <>
        <h1>設定</h1>
        <div className="card flush">
          {SECTIONS.map((s) => (
            <Link className="row" key={s.id} to={`/settings/${s.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>
              <div className="main">
                <div className="title">{s.name}</div>
                <div className="sub title">{s.hint}</div>
              </div>
              <span className="muted">›</span>
            </Link>
          ))}
        </div>
        <p className="sub">この版の作成日時: {__BUILD_INFO__}</p>
      </>
    );
  }
  return (
    <>
      <Link className="back" to="/settings">
        ‹ 設定
      </Link>
      <h1>{current.name}</h1>
      {current.id === 'accounts' && <AccountsSection />}
      {current.id === 'categories' && <NameSection key="categories" table="categories" />}
      {current.id === 'tags' && <NameSection key="tags" table="tags" />}
      {current.id === 'sources' && <SourcesSection />}
      {current.id === 'recurrings' && <RecurringsSection />}
      {current.id === 'quick' && <QuickSection />}
      {current.id === 'walls' && <WallsSection />}
      {current.id === 'reconcile' && <ReconcileSection />}
      {current.id === 'backup' && <BackupSection />}
      {current.id === 'diagnostics' && <DiagnosticsSection />}
    </>
  );
}
