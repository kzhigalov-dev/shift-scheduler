import Link from 'next/link';
import { formatCount, formatMoney } from '@/lib/format';
import { monthShort, monthTitle } from '@/lib/month';
import type { EarningsBar } from '@/lib/summaries/worker';
import { cn } from '@/lib/utils';

const SHIFT_FORMS: [string, string, string] = ['смена', 'смены', 'смен'];

/**
 * Заработок по месяцам: один ряд столбиков, выбранный месяц — терракотой, остальные — её тоном.
 * Столбик — ссылка на месяц; сумма и смены — в подсказке и в имени ссылки (подписи сумм
 * на узком экране не помещаются, итог выбранного месяца и так крупно рядом).
 */
export function EarningsBars({ bars, selected }: { bars: EarningsBar[]; selected: string }) {
  const max = Math.max(...bars.map((b) => b.total), 1);
  return (
    <section aria-labelledby="earnings-bars" data-contain className="flex flex-col rounded-xl border bg-card p-4">
      <h2 id="earnings-bars" className="text-sm font-medium text-muted-foreground">По месяцам</h2>
      <ol className="mt-3 grid flex-1 grid-cols-6 items-end gap-1.5 sm:gap-3">
        {bars.map((bar) => {
          const current = bar.month === selected;
          // Доля от самого большого месяца; ненулевой — не ниже 4 px, чтобы был виден.
          const height = bar.total > 0 ? `max(4px, ${Math.round((bar.total / max) * 100)}%)` : 0;
          const text = `${monthTitle(bar.month)}: ${formatMoney(bar.total)}, ${formatCount(bar.shifts, SHIFT_FORMS)}`;
          return (
            <li key={bar.month} className="min-w-0">
              <Link
                href={`/earnings?month=${bar.month}`}
                title={text}
                aria-label={text}
                aria-current={current ? 'page' : undefined}
                className="group flex flex-col items-center gap-1.5 rounded-md pt-1 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <span className="flex h-16 w-full items-end justify-center border-b sm:h-24">
                  <span
                    className={cn(
                      'w-full max-w-10 rounded-t-[4px] transition-colors',
                      current ? 'bg-primary' : 'bg-primary/25 group-hover:bg-primary/45',
                    )}
                    style={{ height }}
                  />
                </span>
                <span className={cn('text-xs', current ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
                  {monthShort(bar.month)}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
