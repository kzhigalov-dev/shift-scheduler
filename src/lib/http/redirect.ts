/** Ответы входа и лент с ключом в адресе нигде не кешируются (I5 полного ревью безопасности). */
export const NO_STORE = { 'Cache-Control': 'private, no-store' } as const;

/** 307 на путь этого сайта, без кеширования. `path` — только относительный (`/…`). */
export function noStoreRedirect(path: string): Response {
  return new Response(null, { status: 307, headers: { Location: path, ...NO_STORE } });
}

/** 404 без кеширования: неверный ключ календаря или ссылки. */
export function noStoreNotFound(): Response {
  return new Response(null, { status: 404, headers: NO_STORE });
}

const BASE = 'https://app.invalid';

/**
 * Путь возврата из адреса (`?to=`): только путь этого сайта (`/…`; не `//хост`, не `/\хост`, не схема),
 * нормализованный парсером URL; иное — `/`. Открытого редиректа нет.
 */
export function safeReturnPath(to: string | null): string {
  if (!to || !to.startsWith('/')) return '/';
  try {
    const url = new URL(to, BASE);
    return url.origin === BASE ? `${url.pathname}${url.search}` : '/';
  } catch {
    return '/';
  }
}
