import { describe, it, expect } from 'vitest';
import nextConfig from '../next.config';

describe('заголовки безопасности (next.config.ts)', () => {
  it('x-powered-by отключён', () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });

  it('одно правило на все пути с нужными заголовками', async () => {
    const rules = await nextConfig.headers!();
    expect(rules).toHaveLength(1);
    expect(rules[0].source).toBe('/:path*');
    expect(Object.fromEntries(rules[0].headers.map((h) => [h.key, h.value]))).toEqual({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Frame-Options': 'DENY',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), browsing-topics=()',
      'Content-Security-Policy': "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
    });
  });

  it('CSP не ограничивает скрипты и стили — полная CSP с nonce вне этой задачи', async () => {
    const [rule] = await nextConfig.headers!();
    const csp = rule.headers.find((h) => h.key === 'Content-Security-Policy')!.value;
    expect(csp).not.toMatch(/script-src|style-src|default-src/);
  });
});
