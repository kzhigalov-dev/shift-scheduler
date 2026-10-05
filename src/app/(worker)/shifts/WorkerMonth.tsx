'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatDate, pluralRu } from '@/lib/format';
import { currentDate, monthTitle, monthWeeks, shiftMonth } from '@/lib/month';
import type { AvailableEvent, Shift } from '../queries';
import { AvailableCard } from '../available/AvailableCard';
import { ShiftCard } from './ShiftCard';

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const SHIFT_FORMS: [string, string, string] = ['смена', 'смены', 'смен'];
const FREE_FORMS: [string, string, string] = ['свободное', 'свободных', 'свободных'];

/** По датам `YYYY-MM-DD` раскладывает элементы в карту «день → список». */
function byDate<T extends { date: string }>(items: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) map.set(item.date, [...(map.get(item.date) ?? []), item]);
  return map;
}

function dayLabel(date: string, shifts: number, free: number): string {
  const parts = [
    shifts > 0 ? `${shifts} ${pluralRu(shifts, SHIFT_FORMS)}` : null,
    free > 0 ? `${free} ${pluralRu(free, FREE_FORMS)}` : null,
  ].filter(Boolean);
  return `${formatDate(date, { weekday: 'long' })}: ${parts.length > 0 ? parts.join(', ') : 'смен нет'}`;
}

/**
 * Месяц сеткой у работника: своя смена — заливка, свободные места — обводка (у дня могут быть оба
 * признака), сегодня — подчёркнутое число, выбранный день — кольцо.
 * Выбранный день раскрывается карточками. Состояние выбора не переживает смену
 * месяца, поэтому страница ставит `key={month}`.
 */
export function WorkerMonth({ month, shifts, available }: {
  month: string; shifts: Shift[]; available: AvailableEvent[];
}) {
  const today = currentDate();
  const shiftsByDay = byDate(shifts);
  const freeByDay = byDate(available);

  const [selected, setSelected] = useState(() => {
    if (today.startsWith(`${month}-`)) return today;
    const busy = [...shiftsByDay.keys(), ...freeByDay.keys()].sort()[0];
    return busy ?? `${month}-01`;
  });

  const daysShifts = shiftsByDay.get(selected) ?? [];
  const daysFree = freeByDay.get(selected) ?? [];
  const arrow = cn(buttonVariants({ variant: 'outline', size: 'icon-lg' }), 'lg:size-9');

  return (
    <div className="flex flex-col gap-4 lg:grid lg:grid-cols-2 lg:items-start lg:gap-6">
      <section aria-label="Календарь месяца" className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <Link href={`/shifts?view=month&month=${shiftMonth(month, -1)}`} aria-label="Предыдущий месяц" className={arrow}>
            <ChevronLeft aria-hidden="true" />
          </Link>
          <p className="min-w-0 truncate font-medium" title={monthTitle(month)}>{monthTitle(month)}</p>
          <Link href={`/shifts?view=month&month=${shiftMonth(month, 1)}`} aria-label="Следующий месяц" className={arrow}>
            <ChevronRight aria-hidden="true" />
          </Link>
        </div>

        <div className="grid grid-cols-7 gap-x-0.5 gap-y-1">
          {WEEKDAYS.map((name) => (
            <p key={name} className="pb-1 text-center text-xs text-muted-foreground">{name}</p>
          ))}
          {monthWeeks(month).flat().map((date) => {
            if (!date.startsWith(`${month}-`)) return <div key={date} aria-hidden="true" />;
            const own = shiftsByDay.get(date)?.length ?? 0;
            const free = freeByDay.get(date)?.length ?? 0;
            return (
              <button
                key={date}
                type="button"
                aria-label={dayLabel(date, own, free)}
                aria-pressed={date === selected}
                aria-current={date === today ? 'date' : undefined}
                onClick={() => setSelected(date)}
                className={cn(
                  'h-11 w-full rounded-md text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  'hover:bg-muted',
                  // Заливка — своя смена, обводка — свободные места; в один день бывают оба признака.
                  own > 0 && 'bg-status-success-bg font-medium text-status-success-fg hover:bg-status-success-bg',
                  free > 0 && 'border border-primary',
                  // Сегодня — подчёркнутое число, выбранный день — кольцо: не заслоняют друг друга.
                  date === today && 'font-semibold underline underline-offset-4',
                  date === selected && 'ring-2 ring-inset ring-primary',
                )}
              >
                {Number(date.slice(8))}
              </button>
            );
          })}
        </div>

        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <li className="flex items-center gap-1.5">
            <span aria-hidden="true" className="size-3 rounded-sm bg-status-success-bg" />Своя смена
          </li>
          <li className="flex items-center gap-1.5">
            <span aria-hidden="true" className="size-3 rounded-sm border border-primary" />Есть свободные места
          </li>
          <li className="flex items-center gap-1.5">
            <span aria-hidden="true" className="text-[11px] font-semibold leading-none underline underline-offset-2">7</span>Сегодня
          </li>
        </ul>
      </section>

      <section aria-label="Выбранный день" className="flex flex-col gap-3">
        <h2 aria-live="polite" className="font-semibold">{formatDate(selected, { weekday: 'long' })}</h2>
        {daysShifts.length === 0 && daysFree.length === 0 ? (
          <p className="text-muted-foreground">В этот день смен нет.</p>
        ) : (
          <>
            {daysShifts.map((shift) => (
              <ShiftCard key={`${shift.eventId}:${shift.cancelRequested}`} shift={shift} />
            ))}
            {daysFree.map((event) => (
              <AvailableCard key={`${event.eventId}:${event.signupStatus}`} event={event} />
            ))}
          </>
        )}
      </section>
    </div>
  );
}
