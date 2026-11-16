import { describe, expect, it } from 'vitest';
import { countSignificant, formatAmount, normalizeAmount, positionAfter } from './amount';

describe('金額入力', () => {
  it('3桁ごとにカンマを入れる', () => {
    expect(formatAmount('')).toBe('');
    expect(formatAmount('999')).toBe('999');
    expect(formatAmount('1000')).toBe('1,000');
    expect(formatAmount('1234567')).toBe('1,234,567');
    expect(formatAmount('-30000')).toBe('-30,000');
    expect(formatAmount('-')).toBe('-');
  });

  it('カンマ・記号・全角を取り除いて数字だけにする', () => {
    expect(normalizeAmount('1,2345')).toBe('12345');
    expect(normalizeAmount('¥10,000円')).toBe('10000');
    expect(normalizeAmount('１２，３４５')).toBe('12345');
    expect(normalizeAmount('007')).toBe('7');
    expect(normalizeAmount('0')).toBe('0');
    expect(normalizeAmount('')).toBe('');
  });

  it('マイナスは許可した欄だけ残す', () => {
    expect(normalizeAmount('-1,200')).toBe('1200');
    expect(normalizeAmount('-1,200', true)).toBe('-1200');
    expect(normalizeAmount('－500', true)).toBe('-500');
    expect(normalizeAmount('-', true)).toBe('-');
  });

  it('カンマが増えてもカーソルを同じ数字の後ろに戻す', () => {
    // "1,000" の末尾に 0 を足して "1,0000" → 表示 "10,000"、カーソルは末尾
    const typed = '1,0000';
    const count = countSignificant(typed, typed.length);
    expect(positionAfter(formatAmount(normalizeAmount(typed)), count)).toBe('10,000'.length);
    // "12,345" の "2" の後ろで 9 を挿入 → "129,345" → 表示 "129,345"、カーソルは 9 の後ろ
    const inserted = '129,345';
    expect(positionAfter(formatAmount(normalizeAmount(inserted)), countSignificant(inserted, 3))).toBe(3);
    // "1,000" の "1" を消す → ",000" → 表示 "0"(先頭のゼロは除く)
    expect(formatAmount(normalizeAmount(',000'))).toBe('0');
    expect(positionAfter('1,000', 0)).toBe(0);
  });
});
