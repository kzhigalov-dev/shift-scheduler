import { describe, it, expect } from 'vitest';
import { isUuid } from '@/lib/ids';

describe('isUuid', () => {
  it('принимает валидный uuid в любом регистре', () => {
    expect(isUuid('123e4567-e89b-12d3-a456-426614174000')).toBe(true);
    expect(isUuid('123E4567-E89B-12D3-A456-426614174000')).toBe(true);
  });

  it('отвергает неправильный формат строки', () => {
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid('')).toBe(false);
  });

  it('отвергает значения не строкового типа — это граница ввода', () => {
    expect(isUuid(null)).toBe(false);
    expect(isUuid(undefined)).toBe(false);
    expect(isUuid(123)).toBe(false);
    expect(isUuid(['123e4567-e89b-12d3-a456-426614174000'])).toBe(false);
    expect(isUuid({ id: '123e4567-e89b-12d3-a456-426614174000' })).toBe(false);
  });
});
