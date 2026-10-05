import { createHash } from 'node:crypto';
import type { Tx } from '@/db/client';

/** Достаточно метода get — подходит и Headers, и ReadonlyHeaders из next/headers. */
type HeaderSource = { get(name: string): string | null };

/**
 * Адрес клиента для счётчика неудачных входов. На Vercel заголовки ставит сама
 * платформа: сначала `x-vercel-forwarded-for`, затем `x-real-ip`, затем первый
 * адрес из `x-forwarded-for`. Ничего нет — 'unknown' (все такие запросы делят
 * один счётчик).
 */
export function clientIp(headers: HeaderSource): string {
  const first = (name: string) => headers.get(name)?.split(',')[0]?.trim() || null;
  return first('x-vercel-forwarded-for') ?? first('x-real-ip') ?? first('x-forwarded-for') ?? 'unknown';
}

/**
 * Ключ счётчика. IPv4 — сам адрес. IPv6 — подсеть /64 (первые 4 группы): у одного
 * абонента обычно целая /64, и по точному адресу перебор обходился бы сменой адреса.
 * IPv4 внутри IPv6 (`::ffff:1.2.3.4`) — как IPv4.
 */
export function throttleKey(ip: string): string {
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped) return mapped[1];
  if (!ip.includes(':')) return ip;
  const [head, tail = ''] = ip.toLowerCase().split('::');
  const left = head ? head.split(':') : [];
  const right = ip.includes('::') && tail ? tail.split(':') : [];
  const groups = ip.includes('::')
    ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right]
    : left;
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

/** В базу и в логи идёт только этот хеш, сам адрес — никуда. */
export function loginIpHash(ip: string): string {
  return createHash('sha256').update(`login:${throttleKey(ip)}`).digest('hex');
}

/**
 * Общий предел (0015, L3 полного ревью безопасности): за час со всех адресов LOGIN_GLOBAL_FAILURES неудач —
 * перебор; тогда адресу, где уже ошибались, — LOGIN_ATTACK_IP_FAILURES попыток за 15 минут вместо 10.
 * Адрес без своих неудач входит всегда — перебор не запирает менеджера.
 */
export const LOGIN_GLOBAL_FAILURES = 100;
export const LOGIN_ATTACK_IP_FAILURES = 3;

/** Идёт ли перебор (login_under_attack, security definer): для предупреждения менеджеру в Telegram. */
export async function loginUnderAttack(tx: Tx): Promise<boolean> {
  const [row] = await tx<{ attack: boolean }[]>`select login_under_attack() as attack`;
  return row.attack;
}

/** Работает без личности — через login_allowed (security definer). */
export async function isLoginAllowed(tx: Tx, ipHash: string): Promise<boolean> {
  const [row] = await tx<{ allowed: boolean }[]>`select login_allowed(${ipHash}) as allowed`;
  return row.allowed;
}

/** Работает без личности — через note_login_failure (security definer). */
export async function noteLoginFailure(tx: Tx, ipHash: string): Promise<void> {
  await tx`select note_login_failure(${ipHash})`;
}
