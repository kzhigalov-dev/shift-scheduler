/**
 * Имена cookie входа (L7 полного ревью безопасности). На бою (production, HTTPS) — с префиксом `__Host-`:
 * браузер принимает такую cookie только с Secure, Path=/ и без Domain, поэтому соседний поддомен не может
 * подложить или перекрыть её. Локально (`next dev` без HTTPS) — без префикса и без Secure.
 *
 * Переходный период: прежние имена без префикса (`manager_session`, `worker_session`) ещё читаются, а
 * `worker_token` (сырой токен личной ссылки, L6) — меняется на сессию. Прокси (`src/proxy.ts`) отправляет
 * браузер с такими cookie на `/auth/upgrade`, тот переносит их и удаляет старые. Модуль без next/headers:
 * его импортирует и прокси.
 */
export type CookieBase = 'manager_session' | 'worker_session';

/** Cookie личной ссылки до 0015: в ней — сам токен ссылки. Только читается и меняется на сессию. */
export const LEGACY_WORKER_TOKEN = 'worker_token';

/** Secure и `__Host-` — только в production (`next build` / `next start`, Vercel). */
export const securedCookies = (): boolean => process.env.NODE_ENV === 'production';

/** Имя, под которым cookie пишется сейчас. */
export function cookieName(base: CookieBase): string {
  return securedCookies() ? `__Host-${base}` : base;
}

/** Имена, которые остались от прежних версий и ещё действуют до переноса. */
export function legacyCookieNames(): string[] {
  return securedCookies() ? ['manager_session', 'worker_session', LEGACY_WORKER_TOKEN] : [LEGACY_WORKER_TOKEN];
}
