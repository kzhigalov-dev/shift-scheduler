import { isMonth } from '@/lib/month';

/** Куда можно вести после входа из бота (`/tg/[code]?to=…`). */
export const LOGIN_PAGES = ['/shifts', '/available', '/earnings', '/notifications'] as const;
export type LoginPage = (typeof LOGIN_PAGES)[number];

const EARNINGS_MONTH = /^\/earnings\?month=(\d{4}-\d{2})$/;

/**
 * Путь после входа: страница из белого списка как есть или «Заработок» за месяц (`/earnings?month=YYYY-MM`);
 * всё прочее (чужой адрес, `//host`, другой раздел, лишние параметры) — `/shifts`. Открытых редиректов нет:
 * результат — всегда один из этих относительных путей.
 */
export function loginTarget(to: string | null | undefined): string {
  if (typeof to !== 'string') return '/shifts';
  if ((LOGIN_PAGES as readonly string[]).includes(to)) return to;
  const month = EARNINGS_MONTH.exec(to)?.[1];
  return month && isMonth(month) ? `/earnings?month=${month}` : '/shifts';
}
