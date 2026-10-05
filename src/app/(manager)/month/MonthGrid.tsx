import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/format';
import { currentDate, monthWeeks } from '@/lib/month';
import type { MonthEvent } from './queries';
import { EventTile } from './EventTile';

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

function groupByDate(events: MonthEvent[]): Map<string, MonthEvent[]> {
  const byDate = new Map<string, MonthEvent[]>();
  for (const event of events) {
    const list = byDate.get(event.date);
    if (list) list.push(event);
    else byDate.set(event.date, [event]);
  }
  return byDate;
}

/**
 * Месяц: календарная сетка по неделям на широком экране (от 1280 px:
 * при боковом меню в 240 px ячейка уже ~139 px, на 1024 бейджи не помещаются)
 * и список по дням на более узком. Дни вне месяца показаны приглушёнными и без событий.
 */
export function MonthGrid({ month, events }: { month: string; events: MonthEvent[] }) {
  const byDate = groupByDate(events);
  const today = currentDate();
  const weeks = monthWeeks(month);

  return (
    <>
      <div className="hidden overflow-hidden rounded-lg border xl:block">
        <div className="grid grid-cols-7 bg-muted/40 text-xs text-muted-foreground">
          {WEEKDAYS.map((day) => (
            <div key={day} className="px-2 py-1.5">{day}</div>
          ))}
        </div>
        {weeks.map((week) => (
          <div key={week[0]} className="grid grid-cols-7 border-t">
            {week.map((date) => {
              const inMonth = date.startsWith(month);
              const isToday = date === today;
              return (
                <div
                  key={date}
                  className={cn(
                    'flex min-h-28 min-w-0 flex-col gap-1 border-l p-1.5 first:border-l-0',
                    !inMonth && 'bg-muted/40',
                  )}
                >
                  <div className="text-xs">
                    <span
                      aria-current={isToday ? 'date' : undefined}
                      className={cn(
                        'inline-flex size-6 items-center justify-center rounded-full tabular-nums',
                        isToday
                          ? 'bg-primary font-medium text-primary-foreground'
                          : inMonth ? 'text-foreground' : 'text-muted-foreground',
                      )}
                    >
                      <span aria-hidden="true">{Number(date.slice(8))}</span>
                      <span className="sr-only">{formatDate(date, { weekday: 'long' })}</span>
                    </span>
                  </div>
                  {inMonth && byDate.get(date)?.map((event) => <EventTile key={event.id} event={event} compact />)}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-5 xl:hidden">
        {[...byDate].map(([date, dayEvents]) => (
          <section key={date} aria-labelledby={`day-${date}`}>
            <h2
              id={`day-${date}`}
              aria-current={date === today ? 'date' : undefined}
              className={cn('mb-2 text-sm font-medium', date === today ? 'text-primary' : 'text-muted-foreground')}
            >
              {formatDate(date, { weekday: 'long' })}
            </h2>
            <div className="flex flex-col gap-2">
              {dayEvents.map((event) => <EventTile key={event.id} event={event} />)}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
