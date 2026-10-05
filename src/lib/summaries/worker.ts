import { addDays, shiftMonth } from '@/lib/month';

/** Сводки кабинета работника — чистые функции над уже загруженными сменами и свободными событиями. */

/** Сколько дней — «неделя» для свободных мест: сегодня и шесть следующих. */
export const WEEK_DAYS = 7;
/** Сколько месяцев в столбиках «Заработка». */
export const EARNINGS_MONTHS = 6;

/** Ближайшая смена (с сегодняшнего дня) и остальные будущие — по дате и времени начала. */
export function nextShift<T extends { date: string; startTime: string }>(shifts: T[], today: string): {
  next: T | null; rest: T[];
} {
  const upcoming = shifts
    .filter((s) => s.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
  return { next: upcoming[0] ?? null, rest: upcoming.slice(1) };
}

/**
 * Свободные на неделе: события с сегодняшнего дня по шестой следующий, куда можно
 * записаться (отклонённые заявки не в счёт); `total` — всего таких событий.
 */
export function freeThisWeek<T extends { date: string; signupStatus: string | null }>(available: T[], today: string): {
  week: T[]; total: number;
} {
  const open = available.filter((e) => e.signupStatus !== 'rejected');
  const end = addDays(today, WEEK_DAYS);
  return { week: open.filter((e) => e.date >= today && e.date < end), total: open.length };
}

/**
 * Окно столбиков заработка: шесть месяцев по текущий, если выбранный месяц в них;
 * иначе — шесть месяцев по выбранный (давний или будущий), чтобы он всегда был виден.
 */
export function earningsWindow(selected: string, current: string, count = EARNINGS_MONTHS): { from: string; to: string } {
  const recentFrom = shiftMonth(current, -(count - 1));
  const to = selected >= recentFrom && selected <= current ? current : selected;
  return { from: shiftMonth(to, -(count - 1)), to };
}

export type EarningsBar = { month: string; total: number; shifts: number; unpriced: number };

/**
 * Столбики: сумма, смены и смены без ставки по каждому месяцу окна `[from, to]`
 * (месяцы `YYYY-MM`), пустые — нулями. `amount` — уже посчитанная ставка смены
 * (`shiftAmount`, те же правила, что «Заработок»); `null` — без ставки.
 */
export function earningsBars(rows: Array<{ date: string; amount: number | null }>, window: { from: string; to: string }): EarningsBar[] {
  const bars: EarningsBar[] = [];
  for (let m = window.from; m <= window.to; m = shiftMonth(m, 1)) bars.push({ month: m, total: 0, shifts: 0, unpriced: 0 });
  const byMonth = new Map(bars.map((b) => [b.month, b]));
  for (const r of rows) {
    const bar = byMonth.get(r.date.slice(0, 7));
    if (!bar) continue;
    bar.shifts += 1;
    if (r.amount === null) bar.unpriced += 1;
    else bar.total += r.amount;
  }
  return bars;
}
