import { addDays, daysInMonth, parseYmd, weekdayOf, ymd } from './dates';

/**
 * 日本の祝日(2022年以降の祝日法)を計算で求める。外部データは使わない。
 * 春分・秋分の日は天文計算の近似式(1980〜2099年で有効)。正式には前年2月の官報で決まるため、まれにずれる可能性がある。
 * 法改正で祝日が変わった場合は、このファイルの更新が必要。
 */

const nthMonday = (y: number, m: number, n: number) => {
  const firstWeekday = weekdayOf(ymd(y, m, 1));
  return 1 + ((8 - firstWeekday) % 7) + (n - 1) * 7;
};

const vernalEquinox = (y: number) => Math.floor(20.8431 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));
const autumnalEquinox = (y: number) => Math.floor(23.2488 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));

/** 振替休日・国民の休日を除く、その年の祝日。 */
function baseHolidays(y: number): Map<string, string> {
  const list: [number, number, string][] = [
    [1, 1, '元日'],
    [1, nthMonday(y, 1, 2), '成人の日'],
    [2, 11, '建国記念の日'],
    [2, 23, '天皇誕生日'],
    [3, vernalEquinox(y), '春分の日'],
    [4, 29, '昭和の日'],
    [5, 3, '憲法記念日'],
    [5, 4, 'みどりの日'],
    [5, 5, 'こどもの日'],
    [7, nthMonday(y, 7, 3), '海の日'],
    [8, 11, '山の日'],
    [9, nthMonday(y, 9, 3), '敬老の日'],
    [9, autumnalEquinox(y), '秋分の日'],
    [10, nthMonday(y, 10, 2), 'スポーツの日'],
    [11, 3, '文化の日'],
    [11, 23, '勤労感謝の日'],
  ];
  return new Map(list.map(([m, d, name]) => [ymd(y, m, d), name]));
}

const cache = new Map<number, Map<string, string>>();

/** その年の祝日(振替休日・国民の休日を含む)。キーは YYYY-MM-DD。 */
export function holidaysOf(y: number): Map<string, string> {
  const cached = cache.get(y);
  if (cached) return cached;
  const holidays = baseHolidays(y);
  const base = [...holidays.keys()].sort();
  // 振替休日: 祝日が日曜なら、その後の最初の祝日でない日
  for (const date of base) {
    if (weekdayOf(date) !== 0) continue;
    let d = addDays(date, 1);
    while (holidays.has(d)) d = addDays(d, 1);
    holidays.set(d, '振替休日');
  }
  // 国民の休日: 前日と翌日が祝日に挟まれた平日
  for (let m = 1; m <= 12; m++) {
    for (let day = 1; day <= daysInMonth(y, m); day++) {
      const date = ymd(y, m, day);
      if (holidays.has(date) || weekdayOf(date) === 0) continue;
      if (base.includes(addDays(date, -1)) && base.includes(addDays(date, 1))) holidays.set(date, '国民の休日');
    }
  }
  cache.set(y, holidays);
  return holidays;
}

export const holidayName = (date: string) => holidaysOf(parseYmd(date).y).get(date);

/** 銀行の営業日か(土日・祝日・年末年始 12/31〜1/3 を除く)。 */
export function isBankBusinessDay(date: string): boolean {
  const wd = weekdayOf(date);
  if (wd === 0 || wd === 6 || holidayName(date)) return false;
  const md = date.slice(5);
  return md !== '12-31' && md !== '01-02' && md !== '01-03';
}

export type BusinessDayShift = 'next' | 'prev' | 'none';

/** 営業日でなければ、翌営業日(next)または前営業日(prev)にずらす。 */
export function shiftToBusinessDay(date: string, shift: BusinessDayShift): string {
  if (shift === 'none') return date;
  const step = shift === 'next' ? 1 : -1;
  let d = date;
  while (!isBankBusinessDay(d)) d = addDays(d, step);
  return d;
}
