import { NextResponse, type NextRequest } from 'next/server';
import { legacyCookieRedirect } from '@/lib/http/proxyRules';

/** Прокси Next 16 (бывший middleware): перенос cookie прежних версий (`proxyRules.ts`). */
export function proxy(request: NextRequest) {
  return legacyCookieRedirect(request) ?? NextResponse.next();
}

export const config = {
  matcher: [
    // Всё, кроме статики сборки и иконок: им ни перенос cookie, ни заголовки страниц не нужны.
    '/((?!_next/static|_next/image|favicon\\.ico|icon\\.svg|apple-icon\\.png|icon-192\\.png|icon-512\\.png).*)',
  ],
};
