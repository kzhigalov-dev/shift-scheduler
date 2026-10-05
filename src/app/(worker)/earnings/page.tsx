import Link from 'next/link';
import { ChevronLeft, ChevronRight, Wallet } from 'lucide-react';
import { withWorker } from '@/db/client';
import { requireWorker } from '@/lib/auth/session';
import { currentMonth, monthParam, shiftMonth, monthTitle } from '@/lib/month';
import { earningsWindow } from '@/lib/summaries/worker';
import { pluralRu, formatDate, formatMoney } from '@/lib/format';
import { EmptyState } from '@/components/EmptyState';
import { WorkerShell } from '@/components/WorkerShell';
import { buttonVariants } from '@/components/ui/button';
import {
  Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { earningsOverview } from '../queries';
import { EarningsBars } from './EarningsBars';

const SHIFT_FORMS: [string, string, string] = ['смена', 'смены', 'смен'];

export default async function EarningsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string | string[] }>;
}) {
  const worker = await requireWorker();
  const month = monthParam((await searchParams).month);
  // Итог месяца, список и столбики за полгода — одним запросом.
  const { selected: earnings, bars } = await withWorker(worker.id, (tx) =>
    earningsOverview(tx, worker.id, month, earningsWindow(month, currentMonth())));
  const arrow = buttonVariants({ variant: 'outline', size: 'icon-lg' });

  return (
    <WorkerShell fullName={worker.fullName} title="Заработок">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <Link href={`/earnings?month=${shiftMonth(month, -1)}`} aria-label="Предыдущий месяц" className={arrow}>
              <ChevronLeft aria-hidden="true" />
            </Link>
            <p className="min-w-0 truncate font-medium" title={monthTitle(month)}>{monthTitle(month)}</p>
            <Link href={`/earnings?month=${shiftMonth(month, 1)}`} aria-label="Следующий месяц" className={arrow}>
              <ChevronRight aria-hidden="true" />
            </Link>
          </div>

          <div data-contain className="flex flex-1 flex-col justify-center rounded-xl border bg-card p-4">
            <p className="text-sm text-muted-foreground">Итог месяца</p>
            <p className="text-4xl leading-tight font-semibold tabular-nums">{formatMoney(earnings.total)}</p>
            <p className="text-muted-foreground">
              {earnings.shifts} {pluralRu(earnings.shifts, SHIFT_FORMS)}
            </p>
          </div>
        </div>
        <EarningsBars bars={bars} selected={month} />
      </div>

      {earnings.unpriced > 0 && (
        <p className="rounded-lg bg-status-warning-bg p-3 text-status-warning-fg">
          {earnings.unpriced} {pluralRu(earnings.unpriced, SHIFT_FORMS)} без ставки — сумма уточнится.
        </p>
      )}

      {earnings.items.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="Смен в этом месяце нет"
          description="Смены появятся здесь после назначения."
        />
      ) : (
        <>
          <div data-contain className="rounded-xl border bg-card px-4 lg:hidden">
            {earnings.items.map((item, i) => (
              <div
                key={`${item.date}-${i}`}
                className="flex items-baseline justify-between gap-3 border-b py-3 last:border-b-0"
              >
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">{formatDate(item.date, { weekday: 'short' })}</p>
                  <p className="truncate" title={item.concert ?? undefined}>{item.concert ?? '—'}</p>
                </div>
                {item.amount !== null ? (
                  <p className="shrink-0 whitespace-nowrap font-medium tabular-nums">{formatMoney(item.amount)}</p>
                ) : (
                  <p className="shrink-0 whitespace-nowrap text-muted-foreground">Ставка уточняется</p>
                )}
              </div>
            ))}
          </div>
          <div data-contain className="hidden rounded-xl border bg-card lg:block">
            <Table className="text-[15px]">
              <TableCaption className="sr-only">Смены за {monthTitle(month)}</TableCaption>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead scope="col">Дата</TableHead>
                  <TableHead scope="col">Мероприятие</TableHead>
                  <TableHead scope="col">Должность</TableHead>
                  <TableHead scope="col" className="text-right">Сумма</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {earnings.items.map((item, i) => (
                  <TableRow key={`${item.date}-${i}`} className="hover:bg-transparent">
                    <TableCell className="whitespace-nowrap">{formatDate(item.date, { weekday: 'short' })}</TableCell>
                    <TableCell className="max-w-0 w-full truncate" title={item.concert ?? undefined}>
                      {item.concert ?? '—'}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{item.position ?? 'Без должности'}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">
                      {item.amount !== null ? formatMoney(item.amount) : (
                        <span className="text-muted-foreground">Ставка уточняется</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </WorkerShell>
  );
}
