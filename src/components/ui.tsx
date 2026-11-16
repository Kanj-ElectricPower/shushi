import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { addMonths, formatMonth } from '../domain/dates';
import type { AppData } from '../domain/types';

export const DataContext = createContext<AppData | null>(null);

export function useData(): AppData {
  const data = useContext(DataContext);
  if (!data) throw new Error('data not loaded');
  return data;
}

export const yen = (n: number) => `${n < 0 ? '-' : ''}¥${Math.abs(n).toLocaleString('ja-JP')}`;

export const signedYen = (n: number) => (n > 0 ? `+${yen(n)}` : yen(n));

/** 空欄は undefined、数値でなければ NaN。 */
export function parseAmount(s: string): number | undefined {
  const t = s.trim();
  if (t === '') return undefined;
  return /^-?\d+$/.test(t) ? Number(t) : NaN;
}

export function nameOf(list: { id: string; name: string }[], id: string | undefined, fallback = '未設定'): string {
  if (!id) return fallback;
  return list.find((x) => x.id === id)?.name ?? '(削除済み)';
}

// ---------- 通知(画面の下に短く出すメッセージ) ----------

export type ToastKind = 'ok' | 'warn' | 'error';

interface ToastState {
  id: number;
  message: string;
  kind: ToastKind;
}

let currentToast: ToastState | null = null;
let toastSeq = 0;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
const toastListeners = new Set<() => void>();

function setToast(next: ToastState | null) {
  currentToast = next;
  toastListeners.forEach((l) => l());
}

/** 通知を出す。成功は数秒で消え、警告とエラーは閉じるまで残る。 */
export function toast(message: string, kind: ToastKind = 'ok'): number {
  clearTimeout(toastTimer);
  const id = ++toastSeq;
  setToast({ id, message, kind });
  if (kind === 'ok') toastTimer = setTimeout(() => dismissToast(id), 2500);
  return id;
}

export function dismissToast(id?: number) {
  if (id === undefined || currentToast?.id === id) setToast(null);
}

export function Toaster() {
  const t = useSyncExternalStore(
    (l) => {
      toastListeners.add(l);
      return () => {
        toastListeners.delete(l);
      };
    },
    () => currentToast,
  );
  if (!t) return null;
  return (
    <div className={`toast ${t.kind}`} role={t.kind === 'ok' ? 'status' : 'alert'}>
      <span>{t.message}</span>
      {t.kind !== 'ok' && (
        <button type="button" className="btn small" onClick={() => dismissToast(t.id)}>
          閉じる
        </button>
      )}
    </div>
  );
}

/** これを超えても保存が終わらなければ警告を出す */
const SLOW_MS = 5000;

/**
 * 保存処理の二重実行を防ぐ。処理中は busy が true になり、その間の呼び出しは無視する。
 * 連打しても1回しか保存されない(state の反映を待たずに ref で弾く)。
 * 失敗したときと、5秒たっても終わらないときは通知を出す。
 */
export function useBusy() {
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    let finished = false;
    let warned = false;
    // 確認ダイアログを開いている間もタイマーは進むので、時間が来たあと少し待ってから判定する
    const timer = setTimeout(() => {
      setTimeout(() => {
        if (finished) return;
        warned = true;
        toast('保存に時間がかかっています。このまま終わらないときは、アプリを閉じる前に「設定 → 動作チェック」を実行してください。', 'warn');
      }, 400);
    }, SLOW_MS);
    try {
      await fn();
      if (warned) toast('処理が完了しました。');
    } catch (e) {
      console.error(e);
      toast(`保存できませんでした(${e instanceof Error ? e.message : String(e)})。もう一度試してください。`, 'error');
    } finally {
      finished = true;
      clearTimeout(timer);
      running.current = false;
      setBusy(false);
    }
  };
  return { busy, run };
}

// ---------- バックアップの記録(この端末だけの覚え書き) ----------

const LAST_BACKUP_KEY = 'lastBackupAt';

/** 最後にバックアップを書き出した時刻(ミリ秒)。まだなら undefined。 */
export function lastBackupAt(): number | undefined {
  try {
    const v = Number(localStorage.getItem(LAST_BACKUP_KEY));
    return v > 0 ? v : undefined;
  } catch {
    return undefined;
  }
}

export function markBackup() {
  try {
    localStorage.setItem(LAST_BACKUP_KEY, String(Date.now()));
  } catch {
    // 覚えられなくても書き出し自体には影響しない
  }
}

/** 画面の切り替え時に先頭へスクロールする(長いフォームの下で保存したとき、結果が見えるように)。 */
export function useScrollTop() {
  // 新しいブラウザの scrollTo は Promise を返すので、それを片付け関数として返さないようブロックで包む
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function Select({
  value,
  onChange,
  options,
  empty,
  disabled,
}: {
  value: string | undefined;
  onChange: (v: string) => void;
  options: { id: string; name: string }[];
  /** 空の選択肢の表示名。指定しなければ空は選べない。 */
  empty?: string;
  disabled?: boolean;
}) {
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
      {(empty !== undefined || !value) && <option value="">{empty ?? '選択してください'}</option>}
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  );
}

export function Chips({
  value,
  onChange,
  options,
}: {
  value: string | undefined;
  onChange: (v: string) => void;
  options: { id: string; name: string }[];
}) {
  return (
    <div className="chips">
      {options.map((o) => (
        <button type="button" key={o.id} className="chip" aria-pressed={o.id === value} onClick={() => onChange(o.id)}>
          {o.name}
        </button>
      ))}
    </div>
  );
}

export function MonthNav({ month, onChange }: { month: string; onChange: (m: string) => void }) {
  return (
    <div className="monthnav">
      <button className="btn small" onClick={() => onChange(addMonths(month, -1))} aria-label="前の月">
        ‹ 前月
      </button>
      <strong>{formatMonth(month)}</strong>
      <button className="btn small" onClick={() => onChange(addMonths(month, 1))} aria-label="次の月">
        翌月 ›
      </button>
    </div>
  );
}

export function download(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
