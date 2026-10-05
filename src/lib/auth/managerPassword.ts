import { scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

/** Асинхронный scrypt: проверка пароля не блокирует event loop на время хеширования. */
const scryptAsync = promisify(scrypt) as (password: string, salt: string, keylen: number) => Promise<Buffer>;

/** Длина scrypt-хеша в байтах (совпадает с scripts/hash-password.mjs). */
const HASH_BYTES = 64;

/** MANAGER_PASSWORD_HASH: `соль:хеш` в hex. Сгенерировать — scripts/hash-password.mjs. */
export async function verifyManagerPassword(password: string): Promise<boolean> {
  if (!password) return false;
  const stored = process.env.MANAGER_PASSWORD_HASH;
  if (!stored) return false;

  const [salt, hash] = stored.split(':');
  if (!salt || !hash || !/^[0-9a-f]+$/.test(hash)) return false;

  // Хеш должен быть ровно HASH_BYTES * 2 символов (64 байта = 128 hex-символов)
  if (hash.length !== HASH_BYTES * 2) return false;

  const expected = Buffer.from(hash, 'hex');
  const actual = await scryptAsync(password, salt, HASH_BYTES);
  return timingSafeEqual(expected, actual);
}

/**
 * Отказ во входе (неверный пароль или адрес заблокирован) приходит не сразу:
 * задержка замедляет перебор в одном соединении и выравнивает время ответа —
 * по нему не видно, заблокирован адрес или пароль просто неверный. Верный
 * пароль задержки не получает. Число попыток ограничивает счётчик в базе
 * (src/lib/auth/loginThrottle.ts): задержка одна от параллельных запросов не спасает.
 */
export const LOGIN_FAIL_DELAY_MS = 1000;

export function loginFailDelay(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, LOGIN_FAIL_DELAY_MS));
}
