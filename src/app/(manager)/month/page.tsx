import Link from 'next/link';
import { CalendarDays, CalendarPlus, ChevronLeft, ChevronRight, Download, Table2 } from 'lucide-react';
import { withManager } from '@/db/client';
import { requireManager } from '@/lib/auth/session';
import { currentDate, currentMonth, monthParam, shiftMonth, monthTitle } from '@/lib/month';
import { understaffedItems, UNDERSTAFFED_DAYS } from '@/lib/telegram/process';
import { eventTypeOptions } from '@/lib/eventTypes/operations';
import { monthInfo } from '@/lib/monthPlan/months';
import { hasManagerFeed } from '@/lib/calendar/feedKeys';
import { Button } from '@/components/ui/button';
import { CalendarSubscribeDialog } from '@/components/CalendarSubscribeDialog';
import { EmptyState } from '@/components/EmptyState';
import { MoreMenu } from '@/components/MoreMenu';
import { PageHeader } from '@/components/PageHeader';
import { StatusBadge } from '@/components/StatusBadge';
import { monthEvents } from './queries';
import { MonthGrid } from './MonthGrid';
import { MonthSummaryAside, MonthSummaryStrip } from './MonthSummary';
import { NewEventDialog } from './NewEventDialog';
import { connectManagerCalendarAction } from './actions';

export default async function MonthPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string | string[] }>;
}) {
  await requireManager();
  const month = monthParam((await searchParams).month);
  // Нехватка людей — про ближайшие дни, поэтому только в текущем месяце (тот же запрос, что Telegram-сводка).
  const isCurrent = month === currentMonth();
  const [events, info, connected, types, shortage] = await withManager(async (tx) => [
    await monthEvents(tx, month), await monthInfo(tx, month), await hasManagerFeed(tx), await eventTypeOptions(tx),
    isCurrent ? await understaffedItems(tx, currentDate(), UNDERSTAFFED_DAYS) : null,
  ] as const);
  const summary = { month, events, status: info.status, shortage, shortageDays: UNDERSTAFFED_DAYS };

  const showTable = events.length > 0 || info.status === 'draft';
  const newMonthHref = `/month/new?month=${events.length === 0 ? month : shiftMonth(month, 1)}`;

  return (
    <>
      <PageHeader
        title={monthTitle(month)}
        subtitle={info.status === 'draft' ? <StatusBadge tone="warning">Черновик</StatusBadge> : undefined}
        actions={
          <>
            <Button asChild variant="outline" size="icon" className="size-11 lg:size-9">
              <Link href={`/month?month=${shiftMonth(month, -1)}`} aria-label="Предыдущий месяц">
                <ChevronLeft aria-hidden="true" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="icon" className="size-11 lg:size-9">
              <Link href={`/month?month=${shiftMonth(month, 1)}`} aria-label="Следующий месяц">
                <ChevronRight aria-hidden="true" />
              </Link>
            </Button>
            <div className="hidden sm:contents">
              <Button asChild variant="ghost" className="h-11 lg:h-9">
                <Link href="/month">Сегодня</Link>
              </Button>
              {showTable && (
                <Button asChild variant="outline" className="h-11 lg:h-9">
                  <Link href={`/month/${month}/plan`}><Table2 aria-hidden="true" />Таблица</Link>
                </Button>
              )}
              <Button asChild variant="outline" className="h-11 lg:h-9">
                <Link href={newMonthHref}>
                  <CalendarPlus aria-hidden="true" />Новый месяц
                </Link>
              </Button>
            </div>
            <MoreMenu
              className={showTable ? 'size-11 lg:size-9' : 'size-11 sm:hidden'}
              items={[
                { label: 'Сегодня', href: '/month', icon: CalendarDays, className: 'sm:hidden' },
                ...(showTable ? [{ label: 'Таблица', href: `/month/${month}/plan`, icon: Table2, className: 'sm:hidden' }] : []),
                { label: 'Новый месяц', href: newMonthHref, icon: CalendarPlus, className: 'sm:hidden' },
                ...(showTable ? [{ label: 'Скачать таблицу', href: `/month/${month}/export`, icon: Download, download: true }] : []),
              ]}
            />
            <CalendarSubscribeDialog
              title="Мероприятия в моём календаре"
              description="Все мероприятия с набором появятся в вашем календаре и будут обновляться сами. Google обновляет с задержкой до суток."
              connected={connected}
              connect={connectManagerCalendarAction}
              triggerLabel="Календарь"
              triggerClassName="h-11 w-11 p-0 sm:w-auto sm:px-2.5 lg:h-9"
              labelClassName="sr-only sm:not-sr-only"
              triggerTitle="Календарь"
              icon="sync"
            />
            <NewEventDialog types={types} />
          </>
        }
      />

      {events.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title="В этом месяце событий нет"
          description="Создайте месяц из расписания или добавьте событие."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button asChild variant="outline" className="h-11 lg:h-9">
                <Link href={`/month/new?month=${month}`}>
                  <CalendarPlus aria-hidden="true" />Новый месяц
                </Link>
              </Button>
              <NewEventDialog types={types} variant="outline" />
            </div>
          }
        />
      ) : (
        <div className="flex flex-col gap-4 min-[1440px]:grid min-[1440px]:grid-cols-[minmax(0,1fr)_14rem] min-[1440px]:items-start min-[1440px]:gap-5">
          <div className="flex min-w-0 flex-col gap-4">
            <MonthSummaryStrip {...summary} className="flex min-[1440px]:hidden" />
            <MonthGrid month={month} events={events} />
          </div>
          <MonthSummaryAside {...summary} className="hidden min-[1440px]:sticky min-[1440px]:top-6 min-[1440px]:flex" />
        </div>
      )}
    </>
  );
}
