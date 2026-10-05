import Link from 'next/link';
import { Send } from 'lucide-react';
import { withWorker } from '@/db/client';
import { requireWorker } from '@/lib/auth/session';
import { EmptyState } from '@/components/EmptyState';
import { HintCard } from '@/components/HintCard';
import { StatTile } from '@/components/StatTile';
import { WorkerShell } from '@/components/WorkerShell';
import { CalendarSubscribeDialog } from '@/components/CalendarSubscribeDialog';
import { hasWorkerFeed } from '@/lib/calendar/feedKeys';
import { isTelegramConfigured } from '@/lib/telegram/config';
import { getLink } from '@/lib/telegram/links';
import { Button } from '@/components/ui/button';
import { connectCalendarAction } from '../actions';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatMoney } from '@/lib/format';
import { currentDate, currentMonth, monthName, monthParam } from '@/lib/month';
import { freeThisWeek, nextShift } from '@/lib/summaries/worker';
import { availableEvents, myEarnings, myShifts, monthShifts, monthAvailable, type AvailableEvent } from '../queries';
import { AvailableCard } from '../available/AvailableCard';
import { NextShiftCard } from './NextShiftCard';
import { ShiftCard } from './ShiftCard';
import { WorkerMonth } from './WorkerMonth';

/** Сколько свободных мест недели показывать в колонке справа. */
const WEEK_CARDS = 3;

export default async function ShiftsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string | string[]; month?: string | string[] }>;
}) {
  const worker = await requireWorker();
  const params = await searchParams;
  const view = params.view === 'month' ? 'month' : 'list';
  const month = monthParam(params.month);
  const thisMonth = currentMonth();
  const today = currentDate();
  const telegram = isTelegramConfigured();

  // Каждая сводка — один запрос, все — в одной транзакции под личностью работника (RLS).
  const data = await withWorker(worker.id, async (tx) => ({
    shifts: view === 'list' ? await myShifts(tx, worker.id) : [],
    earnings: view === 'list' ? await myEarnings(tx, worker.id, thisMonth) : null,
    available: view === 'list' ? await availableEvents(tx, worker.id) : [],
    linked: view === 'list' && telegram ? (await getLink(tx, worker.id)) !== null : true,
    monthData: view === 'month' ? {
      shifts: await monthShifts(tx, worker.id, month),
      available: await monthAvailable(tx, worker.id, month),
    } : null,
    connected: await hasWorkerFeed(tx, worker.id),
  }));
  const { next, rest } = nextShift(data.shifts, today);
  const free = freeThisWeek(data.available, today);

  return (
    <WorkerShell fullName={worker.fullName} title="Смены"
      aside={view === 'list' ? <ShiftsAside week={free.week} total={free.total} telegramHint={!data.linked} /> : undefined}
      toolbar={(
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Tabs value={view}>
            <TabsList aria-label="Вид">
              <TabsTrigger value="list" asChild>
                <Link href="/shifts" className="px-3">Список</Link>
              </TabsTrigger>
              <TabsTrigger value="month" asChild>
                <Link href="/shifts?view=month" className="px-3">Месяц</Link>
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="flex flex-wrap items-center gap-2">
            <CalendarSubscribeDialog
              title="Смены в моём календаре"
              description="Смены появятся в вашем календаре и будут обновляться сами. Google обновляет с задержкой до суток."
              connected={data.connected}
              connect={connectCalendarAction}
              triggerLabel="Смены в моём календаре"
            />
          </div>
        </div>
      )}
    >
      {data.monthData ? (
        <WorkerMonth key={month} month={month} shifts={data.monthData.shifts} available={data.monthData.available} />
      ) : next === null ? (
        <EmptyState
          illustration="calendar"
          title="Смен пока нет"
          description="Загляните в «Свободные места» — там можно записаться."
          action={(
            <Button asChild size="lg">
              <Link href="/available">Свободные места</Link>
            </Button>
          )}
        />
      ) : (
        <>
          <NextShiftCard key={`${next.eventId}:${next.cancelRequested}`} shift={next} today={today} />
          <div className="grid grid-cols-3 gap-1.5 sm:gap-3">
            <StatTile label={`Смен в ${monthName(thisMonth, 'prepositional')}`} value={data.earnings?.shifts ?? 0} />
            <StatTile label={`Заработок за ${monthName(thisMonth)}`} value={formatMoney(data.earnings?.total ?? 0)} href="/earnings" />
            <StatTile label="Свободных мест на неделе" value={free.week.length} href="/available" />
          </div>
          {rest.length > 0 ? (
            <section aria-labelledby="later-shifts" className="mt-2 flex flex-col gap-3">
              <h2 id="later-shifts" className="text-sm font-medium text-muted-foreground">Дальше</h2>
              <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-2">
                {rest.map((shift) => (
                  <ShiftCard key={`${shift.eventId}:${shift.cancelRequested}`} shift={shift} />
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}
    </WorkerShell>
  );
}

/** Колонка справа (от 1280 px): свободные места недели с «Могу» и подсказка про Telegram. */
function ShiftsAside({ week, total, telegramHint }: { week: AvailableEvent[]; total: number; telegramHint: boolean }) {
  return (
    <>
      <section aria-labelledby="week-free" className="flex flex-col gap-3">
        <h2 id="week-free" className="text-sm font-medium text-muted-foreground">Свободные места на этой неделе</h2>
        {week.length === 0 ? (
          <p className="text-muted-foreground">На этой неделе свободных мест нет.</p>
        ) : (
          week.slice(0, WEEK_CARDS).map((event) => (
            <AvailableCard key={`${event.eventId}:${event.signupStatus}`} event={event} />
          ))
        )}
        {total > 0 ? (
          <Link href="/available" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
            Все свободные места: {total}
          </Link>
        ) : null}
      </section>
      {telegramHint ? (
        <HintCard
          title="Уведомления в Telegram"
          illustration="notes"
          action={(
            <Button asChild variant="outline" className="h-11 lg:h-9">
              <Link href="/notifications"><Send aria-hidden="true" />Подключить</Link>
            </Button>
          )}
        >
          <p className="text-muted-foreground">Пришлём новые смены, напоминания и свободные места.</p>
        </HintCard>
      ) : null}
    </>
  );
}
