import { randomBytes, createHash } from 'node:crypto';

/** 32 случайных байта в base64url — 43 символа. */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/** В базе хранится только хеш: утечка дампа не даёт войти. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
