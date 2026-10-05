import Link from 'next/link';
import { StatusBadge } from '@/components/StatusBadge';
import { formatCount, formatDate } from '@/lib/format';
import type { MonthStatus } from '@/lib/monthPlan/months';
import { fillRate, pendingSummary, shortageSummary } from '@/lib/summaries/month';
import type { UnderstaffedItem } from '@/lib/telegram/process';
import { cn } from '@/lib/utils';
import { PublishButton } from './[month]/plan/PublishButton';
import type { MonthEvent } from './queries';

/** Сколько мероприятий показывать в списках колонки. */
const LIST_LIMIT = 4;
const SIGNUP_FORMS: [string, string, string] = ['заявка', 'заявки', 'заявок'];
const CANCEL_FORMS: [string, string, string] = ['отмена', 'отмены', 'отмен'];
const PEOPLE_FORMS: [string, string, string] = ['человек', 'человека', 'человек'];

type Props = {
  month: string;
  events: MonthEvent[];
  status: MonthStatus | null;
  /** Нехватка людей на ближайшие дни (как в Telegram-сводке); null — месяц не текущий, блока нет. */
  shortage: UnderstaffedItem[] | null;
  shortageDays: number;
};

/** Заполненность: «412 из 440», процент и полоса. */
function FillBar({ events, compact = false }: { events: MonthEvent[]; compact?: boolean }) {
  const rate = fillRate(events);
  const percent = rate.percent ?? 0;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <p className={cn('tabular-nums', compact ? 'text-sm' : '')}>
          <span className="text-muted-foreground">Заполнено </span>
          <span className={cn('font-semibold', compact ? '' : 'text-lg')}>{rate.filled}</span>
          <span className="text-muted-foreground"> из {rate.needed}</span>
        </p>
        {rate.percent !== null ? (
          <p className="text-sm font-medium tabular-nums text-muted-foreground">{`${rate.percent} %`}</p>
        ) : null}
      </div>
      <div
        role="progressbar"
        aria-label="Заполнено мест"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${rate.filled} из ${rate.needed}`}
        className="h-1.5 overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn('h-full rounded-full', percent >= 100 ? 'bg-status-success-fg/70' : 'bg-primary')}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

function StatusLine({ month, status, events }: { month: string; status: MonthStatus | null; events: number }) {
  if (status === 'draft') {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <StatusBadge tone="warning">Черновик</StatusBadge>
        <PublishButton month={month} events={events} />
      </div>
    );
  }
  return <div><StatusBadge tone="success">Опубликован</StatusBadge></div>;
}

/** Строка мероприятия в списке колонки: дата и время мелко, название, под ним метки. */
function EventLink({ href, date, time, title, children }: {
  href: string; date: string; time: string; title: string | null; children: React.ReactNode;
}) {
  const name = title ?? 'Без названия';
  return (
    <li>
      <Link
        href={href}
        className="-mx-2 flex min-w-0 flex-col gap-0.5 rounded-md px-2 py-1.5 outline-none hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span className="text-xs text-muted-foreground tabular-nums">{`${formatDate(date, { weekday: 'short' })}, ${time}`}</span>
        <span className="truncate" title={name}>{name}</span>
        <span className="mt-0.5 flex flex-wrap gap-1">{children}</span>
      </Link>
    </li>
  );
}

/**
 * «Сводка месяца» колонкой справа (от 1440 px): заполненность, ждут решения, нехватка людей
 * на ближайшие дни и статус месяца с «Опубликовать» у черновика. Всё — из уже загруженных данных.
 */
export function MonthSummaryAside({ month, events, status, shortage, shortageDays, className }: Props & { className?: string }) {
  const pending = pendingSummary(events, LIST_LIMIT);
  const lack = shortage ? shortageSummary(shortage, LIST_LIMIT) : null;
  return (
    <aside aria-labelledby="month-summary" data-contain className={cn('flex-col gap-4 rounded-xl border bg-card p-4', className)}>
      <h2 id="month-summary" className="font-semibold">Сводка месяца</h2>
      <FillBar events={events} />

      <section aria-labelledby="month-pending" className="flex flex-col gap-1.5 border-t pt-3">
        <h3 id="month-pending" className="text-sm font-medium">Ждут решения</h3>
        {pending.events.length === 0 ? (
          <p className="text-sm text-muted-foreground">Заявок и отмен нет.</p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground tabular-nums">
              {`заявок ${pending.signups}, отмен ${pending.cancels}`}
            </p>
            <ul className="flex flex-col">
              {pending.events.map((e) => (
                <EventLink key={e.id} href={`/event/${e.id}`} date={e.date} time={e.startTime} title={e.concert}>
                  {e.pendingSignups > 0 ? <StatusBadge tone="warning">{formatCount(e.pendingSignups, SIGNUP_FORMS)}</StatusBadge> : null}
                  {e.cancelRequests > 0 ? <StatusBadge tone="warning">{formatCount(e.cancelRequests, CANCEL_FORMS)}</StatusBadge> : null}
                </EventLink>
              ))}
            </ul>
            {pending.more > 0 ? <p className="text-xs text-muted-foreground">{`И ещё ${pending.more} — в календаре.`}</p> : null}
          </>
        )}
      </section>

      {lack ? (
        <section aria-labelledby="month-shortage" className="flex flex-col gap-1.5 border-t pt-3">
          <h3 id="month-shortage" className="text-sm font-medium">{`Не хватает людей в ближайшие ${shortageDays} дня`}</h3>
          {lack.events === 0 ? (
            <p className="text-sm text-muted-foreground">Нехватки нет.</p>
          ) : (
            <>
              <ul className="flex flex-col">
                {lack.shown.map((i) => (
                  <EventLink key={i.eventId} href={`/event/${i.eventId}`} date={i.date} time={i.start} title={i.concert}>
                    <StatusBadge tone="danger" title={`Не хватает: ${formatCount(i.free, PEOPLE_FORMS)}`}>{`ещё ${i.free}`}</StatusBadge>
                  </EventLink>
                ))}
              </ul>
              {lack.more > 0 ? <p className="text-xs text-muted-foreground">{`И ещё ${lack.more}.`}</p> : null}
            </>
          )}
        </section>
      ) : null}

      <section aria-labelledby="month-status" className="flex flex-col gap-2 border-t pt-3">
        <h3 id="month-status" className="text-sm font-medium">Статус месяца</h3>
        <StatusLine month={month} status={status} events={events.length} />
      </section>
    </aside>
  );
}

/**
 * Та же сводка строкой над календарём (уже 1440 px): полоса заполненности и метки;
 * метка ведёт к мероприятию, если оно одно. Черновик — с «Опубликовать».
 */
export function MonthSummaryStrip({ month, events, status, shortage, className }: Props & { className?: string }) {
  const pending = pendingSummary(events, 1);
  const lack = shortage ? shortageSummary(shortage, 1) : null;
  const only = (n: number, id: string | undefined) => (n === 1 && id ? `/event/${id}` : null);
  const chip = (tone: 'warning' | 'danger', text: string, href: string | null) => (
    href
      ? <Link href={href} className="rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"><StatusBadge tone={tone}>{text}</StatusBadge></Link>
      : <StatusBadge tone={tone}>{text}</StatusBadge>
  );
  const waiting = pending.events.length + pending.more;
  return (
    <section
      aria-label="Сводка месяца"
      data-contain
      className={cn('flex-col gap-2.5 rounded-xl border bg-card px-3 py-2.5 sm:flex-row sm:items-center sm:gap-5 sm:px-4 sm:py-3', className)}
    >
      <div className="sm:max-w-md sm:min-w-56 sm:flex-1"><FillBar events={events} compact /></div>
      {pending.signups + pending.cancels > 0 || (lack && lack.events > 0) || status === 'draft' ? (
        <div className="flex flex-wrap items-center gap-1.5 sm:flex-1">
          {pending.signups > 0 ? chip('warning', formatCount(pending.signups, SIGNUP_FORMS), only(waiting, pending.events[0]?.id)) : null}
          {pending.cancels > 0 ? chip('warning', formatCount(pending.cancels, CANCEL_FORMS), only(waiting, pending.events[0]?.id)) : null}
          {lack && lack.events > 0
            ? chip('danger', `Не хватает: ${formatCount(lack.missing, PEOPLE_FORMS)}`, only(lack.events, lack.shown[0]?.eventId))
            : null}
          {status === 'draft' ? <span className="ml-auto"><PublishButton month={month} events={events.length} /></span> : null}
        </div>
      ) : null}
    </section>
  );
}
