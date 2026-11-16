/**
 * 金額入力欄の文字列処理。入力値は「数字だけ(先頭に - 可)」の生の文字列で持ち、表示だけカンマ区切りにする。
 */

const FULLWIDTH = /[０-９－−ー]/g;

const toHalfWidth = (s: string) =>
  s.replace(FULLWIDTH, (c) => (c >= '０' && c <= '９' ? String.fromCharCode(c.charCodeAt(0) - 0xfee0) : '-'));

/** 入力された文字列を、数字だけの生の値にする(カンマや記号を除き、全角数字は半角にする)。 */
export function normalizeAmount(input: string, allowNegative = false): string {
  const s = toHalfWidth(input);
  const negative = allowNegative && s.trimStart().startsWith('-');
  const digits = s.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  return negative ? `-${digits}` : digits;
}

/** 生の値を 3 桁ごとのカンマ区切りで表示する。 */
export function formatAmount(raw: string): string {
  const negative = raw.startsWith('-');
  const digits = negative ? raw.slice(1) : raw;
  return (negative ? '-' : '') + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * カーソル位置の調整用。text の position より左にある「数字と -」の数を数える。
 * カンマが増減しても、カーソルを同じ数字の後ろに置き直せるようにする。
 */
export function countSignificant(text: string, position: number): number {
  return toHalfWidth(text.slice(0, position)).replace(/[^\d-]/g, '').length;
}

/** formatted の中で、左から count 個目の「数字と -」の直後の位置。 */
export function positionAfter(formatted: string, count: number): number {
  if (count <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < formatted.length; i++) {
    if (/[\d-]/.test(formatted[i]) && ++seen === count) return i + 1;
  }
  return formatted.length;
}
