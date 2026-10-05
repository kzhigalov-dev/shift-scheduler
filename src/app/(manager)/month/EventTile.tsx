import Link from 'next/link';
import { Inbox, UserX } from 'lucide-react';
import { StatusBadge } from '@/components/StatusBadge';
import { pluralRu } from '@/lib/format';
import type { MonthEvent } from './queries';

/**
 * Карточка события: время, название (до двух строк), метки набора и заявок.
 * `compact` (ячейка сетки ~139 px) — «N заявок» и «N без должности» короче:
 * иконка и число, полный текст в title и в названии иконки для скринридера.
 */
export function EventTile({ event, compact = false }: { event: MonthEvent; compact?: boolean }) {
  const signups = `${event.pendingSignups} ${pluralRu(event.pendingSignups, ['заявка', 'заявки', 'заявок'])}`;
  const unplaced = `${event.unplaced} без должности`;
  const complete = event.filled >= event.needed;
  return (
    <Link
      href={`/event/${event.id}`}
      data-contain
      className="block min-w-0 rounded-lg border bg-card p-2 outline-none transition-colors hover:bg-muted/60 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <div className="flex flex-wrap gap-x-1.5 text-xs text-muted-foreground tabular-nums">
        <span>{event.startTime}</span>
        <span className="min-w-0 truncate" title={event.eventTypeName}>{event.eventTypeName}</span>
      </div>
      <p
        title={event.concert ?? undefined}
        className="mt-0.5 line-clamp-2 break-words font-medium"
      >
        {event.concert ?? 'Без названия'}
      </p>
      <div className="mt-1.5 flex flex-wrap gap-1">
        <StatusBadge tone={complete ? 'success' : 'danger'} title={`Набрано ${event.filled} из ${event.needed}`}>
          {event.filled}/{event.needed}
        </StatusBadge>
        {event.pendingSignups > 0 && (
          compact ? (
            <StatusBadge tone="warning" title={signups}>
              <Inbox role="img" aria-label="Заявки" className="mr-1 size-3.5" />
              {event.pendingSignups}
            </StatusBadge>
          ) : (
            <StatusBadge tone="warning">{signups}</StatusBadge>
          )
        )}
        {event.cancelRequests > 0 && <StatusBadge tone="warning" title="Отмена запрошена">отмена</StatusBadge>}
        {event.unplaced > 0 && (
          compact ? (
            <StatusBadge tone="neutral" title={unplaced}>
              <UserX role="img" aria-label="Без должности" className="mr-1 size-3.5" />
              {event.unplaced}
            </StatusBadge>
          ) : (
            <StatusBadge tone="neutral">{unplaced}</StatusBadge>
          )
        )}
      </div>
    </Link>
  );
}
