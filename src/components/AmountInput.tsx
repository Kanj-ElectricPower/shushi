import type { ChangeEvent } from 'react';
import { countSignificant, formatAmount, normalizeAmount, positionAfter } from '../domain/amount';

/**
 * 3 桁ごとにカンマを表示する金額入力欄。
 * value と onChange はカンマなしの生の文字列(例: "12000"、マイナス可の欄は "-500")でやり取りする。
 */
export function AmountInput({
  value,
  onChange,
  allowNegative = false,
  className,
  placeholder,
  autoFocus,
}: {
  value: string;
  onChange: (raw: string) => void;
  allowNegative?: boolean;
  className?: string;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const el = e.target;
    const typed = el.value;
    const count = countSignificant(typed, el.selectionStart ?? typed.length);
    const raw = normalizeAmount(typed, allowNegative);
    const formatted = formatAmount(raw);
    // 表示を先に整えてカーソルを置き直す。React の再描画は同じ値なので DOM を触らず、カーソルが保たれる
    el.value = formatted;
    const caret = positionAfter(formatted, count);
    el.setSelectionRange(caret, caret);
    onChange(raw);
  };

  return (
    <input
      type="text"
      inputMode="numeric"
      autoComplete="off"
      className={className}
      value={formatAmount(normalizeAmount(value, allowNegative))}
      onChange={handleChange}
      placeholder={placeholder}
      autoFocus={autoFocus}
    />
  );
}
