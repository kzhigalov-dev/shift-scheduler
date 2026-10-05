import { CalendarPlus, MapPin } from 'lucide-react';
import { Illustration } from '@/components/Illustration';
import { Button } from '@/components/ui/button';
import { dateInWords, formatDate } from '@/lib/format';
import type { Shift } from '../queries';
import { ShiftBadge } from './ShiftCard';
import { ShiftCancel } from './ShiftCancel';

/** Адрес Анненкирхе — все смены там. */
export const CHURCH_ADDRESS = 'Кирочная ул., 8';

const capitalize = (s: string) => `${s[0].toUpperCase()}${s.slice(1)}`;

/**
 * «Ближайшая смена» над списком: дата словами, приход крупно, начало, мероприятие, должность,
 * адрес и действия. На широкой карточке справа — колокольня (декор, только от 768 px).
 */
export function NextShiftCard({ shift, today }: { shift: Shift; today: string }) {
  const words = dateInWords(shift.date, today);
  // «Сегодня» и «завтра» — без даты; дату дописываем, чтобы не считать в уме.
  const when = words === 'сегодня' || words === 'завтра'
    ? `${capitalize(words)}, ${formatDate(shift.date, { weekday: 'short' }).toLowerCase()}`
    : capitalize(words);
  const startLine = `Начало ${shift.startTime}`;

  return (
    <section aria-labelledby="next-shift" data-contain className="flex items-stretch gap-6 rounded-xl border bg-card p-4 sm:p-5">
      <div className="min-w-0 flex-1">
        <h2 id="next-shift" className="text-xs font-semibold tracking-wide text-primary uppercase">Ближайшая смена</h2>
        <p className="mt-1 font-medium" data-allow-wrap>{when}</p>
        <p className="mt-2 text-3xl leading-none font-semibold tabular-nums">
          {shift.arriveTime ? `Приход ${shift.arriveTime}` : startLine}
        </p>
        {shift.arriveTime ? <p className="mt-1.5 text-muted-foreground tabular-nums">{startLine}</p> : null}
        {shift.concert ? (
          <p className="mt-3 line-clamp-2 break-words font-medium" title={shift.concert}>{shift.concert}</p>
        ) : null}
        <p className="mt-1 flex items-center gap-1.5 text-muted-foreground">
          <MapPin aria-hidden="true" className="size-4 shrink-0" />{CHURCH_ADDRESS}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <ShiftBadge shift={shift} />
          <Button asChild variant="outline" size="lg" className="ml-auto px-3 lg:h-9">
            <a href={`/shifts/${shift.eventId}/calendar`}><CalendarPlus aria-hidden="true" />В календарь</a>
          </Button>
          <ShiftCancel eventId={shift.eventId} date={shift.date} cancelRequested={shift.cancelRequested} />
        </div>
      </div>
      <Illustration name="tower" size={176} className="hidden self-end md:block" />
    </section>
  );
}
