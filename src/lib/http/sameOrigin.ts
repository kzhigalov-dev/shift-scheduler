/** Первое значение заголовка прокси (`a, b` → `a`). */
const first = (value: string | null): string | null => value?.split(',')[0].trim() || null;

/** Хост из адреса `http(s)://…` в нижнем регистре; иное (`null`, без схемы, другая схема) — null. */
function hostOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.host : null;
  } catch {
    return null;
  }
}

/**
 * Запрос пришёл со страницы самого приложения: Origin (а без него — Referer) указывает на тот же хост,
 * на который пришёл запрос (`x-forwarded-host` за прокси Vercel, иначе `host`) — так же Next проверяет
 * server actions. Route Handlers Next не проверяет, а POST-маршруты загрузки работают по cookie менеджера:
 * без проверки они держатся только на `SameSite=Lax` (L1 полного ревью безопасности). Ни Origin, ни Referer —
 * отказ: браузер отправляет Origin с каждым POST.
 */
export function isSameOrigin(request: Request): boolean {
  const raw = first(request.headers.get('x-forwarded-host')) ?? first(request.headers.get('host')) ?? hostOf(request.url);
  const host = raw ? hostOf(`https://${raw}`) : null;
  if (!host) return false;
  const origin = request.headers.get('origin');
  const source = origin ?? request.headers.get('referer');
  return source !== null && hostOf(source) === host;
}

/** Ответ на запрос не со страницы приложения. */
export function crossSiteResponse(): Response {
  return Response.json({ error: 'Запрос отклонён: откройте страницу приложения и повторите.' }, { status: 403 });
}
