import Link from 'next/link';
import { ChevronLeft, ChevronRight, ChevronDown, Download, Wallet } from 'lucide-react';
import { withManager } from '@/db/client';
import { requireManager } from '@/lib/auth/session';
import { monthName, monthParam, shiftMonth, monthTitle } from '@/lib/month';
import { payComparison } from '@/lib/summaries/month';
import { HintCard } from '@/components/HintCard';
import { WithAside } from '@/components/WithAside';
import { formatDate, formatMoney } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { StatusBadge } from '@/components/StatusBadge';
import { payForMonth } from './queries';

export default async function PayPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string | string[] }>;
}) {
  await requireManager();
  const month = monthParam((await searchParams).month);
  const previousMonth = shiftMonth(month, -1);
  // Сравнение с прошлым месяцем — отдельный виджет, один запрос.
  const [{ rows, details }, previous] = await withManager(async (tx) => [
    await payForMonth(tx, month), await payForMonth(tx, previousMonth),
  ] as const);

  const totalShifts = rows.reduce((s, r) => s + r.shifts, 0);
  const totalAmount = rows.reduce((s, r) => s + r.total, 0);
  const totalUnpriced = rows.reduce((s, r) => s + r.unpriced, 0);
  const previousTotal = previous.rows.reduce((s, r) => s + r.total, 0);
  const compare = payComparison(totalAmount, previousTotal);
  const hint = (
    <HintCard
      title="Как считается"
      illustration="candle"
      items={[
        'Ставка смены — первая заполненная: личная, места, должности, концерта.',
        '«Без ставки» — смены, где ставки нет нигде: сумма уточнится.',
        '«Скачать .xlsx» — эта же таблица файлом.',
      ]}
    />
  );

  return (
    <>
      <PageHeader
        title={`Оплата · ${monthTitle(month)}`}
        actions={
          <>
            <Button asChild variant="outline" size="icon" className="size-11 lg:size-9">
              <Link href={`/pay?month=${shiftMonth(month, -1)}`} aria-label="Предыдущий месяц">
                <ChevronLeft aria-hidden="true" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="icon" className="size-11 lg:size-9">
              <Link href={`/pay?month=${shiftMonth(month, 1)}`} aria-label="Следующий месяц">
                <ChevronRight aria-hidden="true" />
              </Link>
            </Button>
            <Button asChild className="h-11 lg:h-9">
              <a href={`/pay/export?month=${month}`}>
                <Download aria-hidden="true" />
                Скачать .xlsx
              </a>
            </Button>
          </>
        }
      />

      <WithAside width="readable" aside={hint}>
        {rows.length === 0 ? (
          <EmptyState
            icon={Wallet}
            title="В этом месяце смен нет"
            description="Оплата появится, когда люди будут назначены на события."
          />
        ) : (
          <div className="flex flex-col gap-6">
            <div className="grid gap-3 sm:grid-cols-3">
              <Card data-contain>
                <CardContent className="flex flex-col gap-1">
                  <p className="text-muted-foreground">Выплатить всего</p>
                  <p className="text-[28px] leading-9 font-semibold tabular-nums">{formatMoney(totalAmount)}</p>
                  <p className="text-sm text-muted-foreground tabular-nums" data-allow-wrap>
                    {previousTotal > 0
                      ? `В ${monthName(previousMonth, 'prepositional')}: ${formatMoney(previousTotal)}${compare.percent === null || compare.percent === 0 ? '' : ` · ${compare.percent > 0 ? '+' : '\u2212'}${Math.abs(compare.percent)}\u00a0%`}`
                      : `В ${monthName(previousMonth, 'prepositional')} выплат не было.`}
                  </p>
                </CardContent>
              </Card>
              <Card data-contain>
                <CardContent className="flex flex-col gap-1">
                  <p className="text-muted-foreground">Смен</p>
                  <p className="text-[28px] leading-9 font-semibold tabular-nums">{totalShifts}</p>
                </CardContent>
              </Card>
              <Card
                data-contain
                className={totalUnpriced > 0 ? 'border-transparent bg-status-warning-bg text-status-warning-fg' : undefined}
              >
                <CardContent className="flex flex-col gap-1">
                  <p className={totalUnpriced > 0 ? undefined : 'text-muted-foreground'}>Без ставки</p>
                  <p className="text-[28px] leading-9 font-semibold tabular-nums">{totalUnpriced}</p>
                </CardContent>
              </Card>
            </div>

            <div data-layout-scroll className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>ФИО</TableHead>
                    <TableHead className="w-16 text-right sm:w-24">Смен</TableHead>
                    <TableHead className="text-right">Сумма</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.workerId}>
                      <TableCell>
                        <div className="flex flex-col items-start gap-1 sm:flex-row sm:items-center sm:gap-2">
                          <div className="max-w-36 min-w-0 truncate sm:max-w-xs" title={row.fullName}>{row.fullName}</div>
                          {row.unpriced > 0 && (
                            <StatusBadge tone="warning">{row.unpriced} без ставки</StatusBadge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{row.shifts}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatMoney(row.total)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow className="font-semibold hover:bg-transparent">
                    <TableCell>Итого</TableCell>
                    <TableCell className="text-right tabular-nums">{totalShifts}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(totalAmount)}</TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </div>

            <details className="group rounded-lg border">
              <summary className="flex h-11 cursor-pointer list-none items-center gap-2 px-4 font-medium select-none lg:h-9 [&::-webkit-details-marker]:hidden">
                <ChevronDown
                  className="size-4 shrink-0 text-muted-foreground transition-transform group-not-open:-rotate-90"
                  aria-hidden="true"
                />
                По сменам
              </summary>
              <div data-layout-scroll className="overflow-x-auto border-t">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Дата</TableHead>
                      <TableHead>Концерт</TableHead>
                      <TableHead>ФИО</TableHead>
                      <TableHead>Должность</TableHead>
                      <TableHead className="text-right">Сумма</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {details.map((d, i) => (
                      <TableRow key={`${d.date}-${d.fullName}-${i}`}>
                        <TableCell>{formatDate(d.date)}</TableCell>
                        <TableCell>
                          {d.concert ? (
                            <div className="max-w-xs truncate" title={d.concert}>{d.concert}</div>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="max-w-56 truncate" title={d.fullName}>{d.fullName}</div>
                        </TableCell>
                        <TableCell className={d.position ? undefined : 'text-muted-foreground'}>
                          {d.position ?? 'Без должности'}
                        </TableCell>
                        <TableCell
                          className={`text-right tabular-nums${d.amount === null ? ' text-muted-foreground' : ''}`}
                        >
                          {d.amount !== null ? formatMoney(d.amount) : 'Ставка уточняется'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </details>
          </div>
        )}
      </WithAside>
    </>
  );
}
