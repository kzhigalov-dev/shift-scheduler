import { NextResponse, type NextRequest } from 'next/server';
import { legacyCookieNames } from '@/lib/auth/cookieNames';

/** Здесь cookie не переносятся: сам перенос, API и ленты (не страницы), вход из бота и по ссылке (свои правила). */
const NO_UPGRADE = ['/auth/', '/api/', '/cal/', '/tg/', '/w/'];

/** Обычный переход на страницу (документ): не запрос данных Next (RSC, prefetch), не action и не загрузка. */
function isPageNavigation(request: NextRequest): boolean {
  if (request.method !== 'GET') return false;
  const h = request.headers;
  if (h.has('rsc') || h.has('next-router-prefetch') || h.has('next-action') || h.get('purpose') === 'prefetch') return false;
  const dest = h.get('sec-fetch-dest');
  return dest ? dest === 'document' : (h.get('accept') ?? '').includes('text/html');
}

/**
 * Переходный период L6/L7: браузер со старой cookie входа (сырой токен ссылки `worker_token`, имена без
 * `__Host-`) при переходе на страницу уходит на `/auth/upgrade?to=<путь>` — там cookie переносятся, старые
 * удаляются, и браузер возвращается. Запросы данных и actions не перенаправляются: старые cookie они ещё читают.
 */
export function legacyCookieRedirect(request: NextRequest): NextResponse | null {
  const { pathname, search } = request.nextUrl;
  if (!isPageNavigation(request) || NO_UPGRADE.some((prefix) => pathname.startsWith(prefix))) return null;
  if (!legacyCookieNames().some((name) => request.cookies.has(name))) return null;
  const target = request.nextUrl.clone();
  target.pathname = '/auth/upgrade';
  target.search = '';
  target.searchParams.set('to', `${pathname}${search}`);
  const response = NextResponse.redirect(target, 307);
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
