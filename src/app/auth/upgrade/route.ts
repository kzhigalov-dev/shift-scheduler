import { upgradeLegacyCookies } from '@/lib/auth/session';
import { noStoreRedirect, safeReturnPath } from '@/lib/http/redirect';

/**
 * Перенос cookie входа прежних версий (переходный период L6/L7): прокси (`src/proxy.ts`) приводит сюда
 * браузер со старой cookie при обычном переходе на страницу. Права — сами cookie этого браузера: роль не
 * меняется и не расширяется, меняется только хранение (сессия вместо токена ссылки, имена `__Host-`).
 * Затем — обратно на `to` (только путь этого сайта).
 */
export async function GET(request: Request) {
  const result = await upgradeLegacyCookies();
  if (result === 'link-invalid') return noStoreRedirect('/login?for=worker&error=link');
  return noStoreRedirect(safeReturnPath(new URL(request.url).searchParams.get('to')));
}
