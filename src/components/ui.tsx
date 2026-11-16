import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
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

/**
 * 保存処理の二重実行を防ぐ。処理中は busy が true になり、その間の呼び出しは無視する。
 * 連打しても1回しか保存されない(state の反映を待たずに ref で弾く)。
 */
export function useBusy() {
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      await fn();
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  return { busy, run };
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
