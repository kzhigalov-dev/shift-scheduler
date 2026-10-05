import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

/** L3: скрипт хеша пароля менеджера не принимает короткие пароли. Пароль идёт через stdin, как в README. */
const run = (password: string) => spawnSync(process.execPath, [path.resolve(__dirname, '../scripts/hash-password.mjs')], {
  input: password, encoding: 'utf8',
});

describe('scripts/hash-password.mjs', () => {
  it('пароль короче 12 символов — отказ, хеш не печатается', () => {
    const res = run('short-pass1');
    expect(res.status).toBe(1);
    expect(res.stdout).toBe('');
    expect(res.stderr).toMatch(/12/);
  });

  it('пустой пароль — отказ', () => {
    expect(run('').status).toBe(1);
  });

  it('12 символов и больше — соль:хеш в hex, сам пароль не печатается', () => {
    const res = run('twelve-chars\n');
    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/);
    expect(res.stdout + res.stderr).not.toContain('twelve-chars');
  });

  it('длину считает по символам, а не байтам: 11 кириллических — отказ', () => {
    expect(run('абвгдежзийк').status).toBe(1);
  });
});
