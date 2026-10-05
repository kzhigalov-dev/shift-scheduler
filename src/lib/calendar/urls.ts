import { MOSCOW_OFFSET_MIN } from '@/lib/calendar/ics';

const LOCAL = /^(localhost|127\.0\.0\.1)(:\d+)?$/;
const VALID_HOST = /^[A-Za-z0-9.-]+(:\d+)?$/;

/** Первое значение заголовка прокси (`a, b` → `a`). */
const first = (value: string | null): string | null => value?.split(',')[0].trim() || null;

/** Адрес сайта из заголовков запроса (Vercel ставит x-forwarded-*). */
export function originFromHeaders(headers: Headers): string {
  const forwarded = first(headers.get('x-forwarded-host'));
  const direct = first(headers.get('host'));
  const host = [forwarded, direct].find((h): h is string => h !== null && VALID_HOST.test(h)) ?? 'localhost';
  const rawProto = first(headers.get('x-forwarded-proto'));
  const proto = rawProto === 'http' || rawProto === 'https' ? rawProto : LOCAL.test(host) ? 'http' : 'https';
  return `${proto}://${host}`;
}

/** Ссылки подписки: прямая, webcal:// (Apple) и для Google Календаря. */
export function feedUrls(origin: string, path: string) {
  const https = `${origin}${path}`;
  const webcal = https.replace(/^https?:\/\//, 'webcal://');
  return { https, webcal, google: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}` };
}

/** Дата `YYYY-MM-DD` по Москве, минус N дней. */
export function moscowDateMinusDays(now: Date, days: number): string {
  const moscow = new Date(now.getTime() + MOSCOW_OFFSET_MIN * 60_000);
  moscow.setUTCDate(moscow.getUTCDate() - days);
  return moscow.toISOString().slice(0, 10);
}
