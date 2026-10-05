import { CalendarPlus } from 'lucide-react';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { formatDate, formatMoney } from '@/lib/format';
import type { Shift } from '../queries';
import { ShiftCancel } from './ShiftCancel';

/** Подпись должности и ставки: «БИЛЕТЫ · 1 300 ₽», без ставки — «Ставка уточняется». */
export function shiftLabel(shift: Shift): { position: string; rate: string } {
  return {
    position: shift.position ?? 'Без должности',
    rate: shift.amount !== null ? formatMoney(shift.amount) : 'Ставка уточняется',
  };
}

/** Метка «должность · ставка»; должность усекается, ставка — никогда. */
export function ShiftBadge({ shift }: { shift: Shift }) {
  const { position, rate } = shiftLabel(shift);
  return (
    <StatusBadge tone="success" title={`${position} · ${rate}`} className="max-w-full">
      <span className="min-w-0 truncate">{position}</span>
      <span className="shrink-0">{' · '}{rate}</span>
    </StatusBadge>
  );
}

export function ShiftCard({ shift }: { shift: Shift }) {
  const startLine = `Начало ${shift.startTime}`;
  // Без времени прихода крупно стоит «Начало» — второй раз его не повторяем.
  const detail = shift.arriveTime
    ? (shift.concert ? `${shift.concert} · ${startLine}` : startLine)
    : shift.concert;

  return (
    <div data-contain className="rounded-xl border bg-card p-4">
      <p className="text-xs text-muted-foreground">{formatDate(shift.date, { weekday: 'short' })}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">
        {shift.arriveTime ? `Приход ${shift.arriveTime}` : startLine}
      </p>
      {detail ? (
        <p className="mt-1 line-clamp-2 break-words text-muted-foreground" title={detail}>{detail}</p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <ShiftBadge shift={shift} />
        <Button asChild variant="ghost" size="lg" className="ml-auto px-3 lg:h-9">
          <a href={`/shifts/${shift.eventId}/calendar`}><CalendarPlus aria-hidden="true" />В календарь</a>
        </Button>
        <ShiftCancel eventId={shift.eventId} date={shift.date} cancelRequested={shift.cancelRequested} />
      </div>
    </div>
  );
}
