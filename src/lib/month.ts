const MONTH_RE = /^(19|20)\d{2}-(0[1-9]|1[0-2])$/;

/** Проверка месяца `YYYY-MM` из адреса или от браузера. */
export function isMonth(value: string): boolean {
  return MONTH_RE.test(value);
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Текущий месяц по московскому времени. */
export function currentMonth(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit',
  }).formatToParts(now);
  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  return `${year}-${month}`;
}

/** Месяц из параметра запроса, если он валиден; иначе текущий. */
export function monthParam(value: string | string[] | undefined, now: Date = new Date()): string {
  return typeof value === 'string' && MONTH_RE.test(value) ? value : currentMonth(now);
}

/** Сдвигает `YYYY-MM` на `delta` месяцев, корректно через границу года. */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

/** Полуоткрытый диапазон [from, to) — индекс по event_date работает. */
export function monthRange(month: string): { from: string; to: string } {
  return { from: `${month}-01`, to: `${shiftMonth(month, 1)}-01` };
}

/** Название месяца по-русски с заглавной буквы, например «Июль 2026». */
export function monthTitle(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const name = new Intl.DateTimeFormat('ru-RU', { month: 'long', timeZone: 'UTC' })
    .format(new Date(Date.UTC(y, m - 1, 1)));
  return `${name[0].toUpperCase()}${name.slice(1)} ${y}`;
}

/** Сегодняшняя дата `YYYY-MM-DD` по московскому времени. */
export function currentDate(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Месяц целыми неделями (пн–вс): даты `YYYY-MM-DD`, включая хвосты соседних месяцев. */
export function monthWeeks(month: string): string[][] {
  const [y, m] = month.split('-').map(Number);
  const first = Date.UTC(y, m - 1, 1);
  const last = Date.UTC(y, m, 0);
  const DAY = 86_400_000;
  const lead = (new Date(first).getUTCDay() + 6) % 7; // пн = 0
  const trail = 6 - ((new Date(last).getUTCDay() + 6) % 7);
  const weeks: string[][] = [];
  for (let t = first - lead * DAY; t <= last + trail * DAY; t += 7 * DAY) {
    weeks.push(Array.from({ length: 7 }, (_, i) => new Date(t + i * DAY).toISOString().slice(0, 10)));
  }
  return weeks;
}

const MONTHS_PREPOSITIONAL = [
  'январе', 'феврале', 'марте', 'апреле', 'мае', 'июне',
  'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре',
];

/**
 * Название месяца `YYYY-MM` без года, со строчной: «октябрь» (именительный —
 * «Заработок за октябрь») или «октябре» (предложный — «Смен в октябре»).
 */
export function monthName(month: string, form: 'nominative' | 'prepositional' = 'nominative'): string {
  if (form === 'prepositional') return MONTHS_PREPOSITIONAL[Number(month.slice(5, 7)) - 1];
  return monthTitle(month).replace(/\s\d{4}$/u, '').toLowerCase();
}

/** Короткое название месяца для подписи столбика: «окт.», «май». */
export function monthShort(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Intl.DateTimeFormat('ru-RU', { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)));
}

/** Дата `YYYY-MM-DD`, сдвинутая на `days` дней (через границы месяца и года). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
