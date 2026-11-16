const pad = (n: number) => String(n).padStart(2, '0');

export const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

export function toYmd(date: Date): string {
  return ymd(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

export const today = () => toYmd(new Date());

export function parseYmd(s: string): { y: number; m: number; d: number } {
  const [y, m, d] = s.split('-').map(Number);
  return { y, m, d };
}

/** 'YYYY-MM' */
export const monthOf = (date: string) => date.slice(0, 7);

export const daysInMonth = (y: number, m: number) => new Date(y, m, 0).getDate();

/** 月をまたいで正規化し、日は月末に丸める(31 を指定すれば常に月末)。 */
export function dateInMonth(y: number, m: number, day: number): string {
  const base = new Date(y, m - 1, 1);
  const yy = base.getFullYear();
  const mm = base.getMonth() + 1;
  return ymd(yy, mm, Math.min(day, daysInMonth(yy, mm)));
}

export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export function addDays(date: string, delta: number): string {
  const { y, m, d } = parseYmd(date);
  return toYmd(new Date(y, m - 1, d + delta));
}

export const weekdayOf = (date: string) => {
  const { y, m, d } = parseYmd(date);
  return new Date(y, m - 1, d).getDay();
};

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

export function formatDate(date: string): string {
  const { m, d } = parseYmd(date);
  return `${m}/${d}(${WEEKDAYS[weekdayOf(date)]})`;
}

export function formatMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${y}年${m}月`;
}
