import { describe, it, expect } from 'vitest';
import { generateToken, hashToken } from '@/lib/auth/token';

describe('токены', () => {
  it('длинный и не повторяется', () => {
    const a = generateToken();
    expect(a).not.toBe(generateToken());
    expect(a.length).toBeGreaterThanOrEqual(43);
  });

  it('только url-безопасные символы', () => {
    expect(generateToken()).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('хеш детерминирован и не равен токену', () => {
    const t = generateToken();
    expect(hashToken(t)).toBe(hashToken(t));
    expect(hashToken(t)).not.toBe(t);
    expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
  });
});
