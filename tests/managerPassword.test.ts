import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { scryptSync, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import {
  verifyManagerPassword,
  loginFailDelay,
  LOGIN_FAIL_DELAY_MS,
} from '@/lib/auth/managerPassword';

beforeAll(() => {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync('правильный-пароль', salt, 64).toString('hex');
  process.env.MANAGER_PASSWORD_HASH = `${salt}:${hash}`;
});

describe('пароль менеджера', () => {
  it('принимает верный', async () => {
    expect(await verifyManagerPassword('правильный-пароль')).toBe(true);
  });

  it('отклоняет неверный и пустой', async () => {
    expect(await verifyManagerPassword('неверный')).toBe(false);
    expect(await verifyManagerPassword('')).toBe(false);
  });

  it('без настроенного хеша никого не пускает', async () => {
    const saved = process.env.MANAGER_PASSWORD_HASH;
    delete process.env.MANAGER_PASSWORD_HASH;
    expect(await verifyManagerPassword('правильный-пароль')).toBe(false);
    process.env.MANAGER_PASSWORD_HASH = saved;
  });

  it('битый формат хеша не роняет проверку', async () => {
    const saved = process.env.MANAGER_PASSWORD_HASH;
    process.env.MANAGER_PASSWORD_HASH = 'не-хеш';
    expect(await verifyManagerPassword('правильный-пароль')).toBe(false);
    process.env.MANAGER_PASSWORD_HASH = saved;
  });

  it('обрезанный или неверной длины хеш никого не пускает', async () => {
    const saved = process.env.MANAGER_PASSWORD_HASH;
    const [salt, hash] = saved!.split(':');
    // Обрезанный хеш (первые 2 символа вместо 128)
    process.env.MANAGER_PASSWORD_HASH = `${salt}:${hash.slice(0, 2)}`;
    expect(await verifyManagerPassword('правильный-пароль')).toBe(false);
    // Нечётная длина (127 вместо 128)
    process.env.MANAGER_PASSWORD_HASH = `${salt}:${hash.slice(0, 127)}`;
    expect(await verifyManagerPassword('правильный-пароль')).toBe(false);
    process.env.MANAGER_PASSWORD_HASH = saved;
  });
});

describe('хеш из scripts/hash-password.mjs', () => {
  it('совпадает с асинхронной проверкой', async () => {
    const saved = process.env.MANAGER_PASSWORD_HASH;
    const stdout = execFileSync(process.execPath, [path.resolve(__dirname, '../scripts/hash-password.mjs')], {
      input: 'пароль-из-скрипта',
      encoding: 'utf8',
    });
    process.env.MANAGER_PASSWORD_HASH = stdout.trim();
    expect(await verifyManagerPassword('пароль-из-скрипта')).toBe(true);
    expect(await verifyManagerPassword('другой')).toBe(false);
    process.env.MANAGER_PASSWORD_HASH = saved;
  });
});

describe('проверка не блокирует event loop', () => {
  it('таймер успевает сработать, пока считается scrypt', async () => {
    let ticked = false;
    const tick = new Promise<void>((resolve) => setImmediate(() => { ticked = true; resolve(); }));
    const check = verifyManagerPassword('правильный-пароль').then((ok) => ({ ok, tickedBefore: ticked }));
    await tick;
    const { ok, tickedBefore } = await check;
    expect(ok).toBe(true);
    expect(tickedBefore).toBe(true);
  });
});

describe('задержка перед отказом во входе', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('ответ приходит не раньше LOGIN_FAIL_DELAY_MS', async () => {
    vi.useFakeTimers();
    let resolved = false;
    const promise = loginFailDelay().then(() => {
      resolved = true;
    });

    await vi.advanceTimersByTimeAsync(LOGIN_FAIL_DELAY_MS - 1);
    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await promise;
    expect(resolved).toBe(true);
  });
});
