import { describe, it, expect } from 'vitest';
import { parseQuantity, checkQuantity, MAX_DEFAULT_QUANTITY } from '@/lib/quantity';
import { UserError } from '@/lib/errors';

describe('parseQuantity', () => {
  it('отвергает пустую и пробельную строку', () => {
    expect(() => parseQuantity('')).toThrow(UserError);
    expect(() => parseQuantity('')).toThrow('Укажите количество людей (0 — должность не нужна)');
    expect(() => parseQuantity('   ')).toThrow('Укажите количество людей (0 — должность не нужна)');
    expect(() => parseQuantity(null)).toThrow('Укажите количество людей (0 — должность не нужна)');
  });

  it('разбирает число', () => {
    expect(parseQuantity('0')).toBe(0);
    expect(parseQuantity(' 5 ')).toBe(5);
  });
});

describe('checkQuantity', () => {
  it('пропускает целые от 0 до MAX_DEFAULT_QUANTITY', () => {
    expect(MAX_DEFAULT_QUANTITY).toBe(20);
    expect(() => checkQuantity(0)).not.toThrow();
    expect(() => checkQuantity(20)).not.toThrow();
  });

  it('отвергает 21, 100000000, минус, дробь и не-число', () => {
    for (const n of [21, 100_000_000, -1, 1.5, Number.NaN]) {
      expect(() => checkQuantity(n)).toThrow(UserError);
      expect(() => checkQuantity(n)).toThrow('Количество — целое, от 0 до 20');
    }
  });
});
