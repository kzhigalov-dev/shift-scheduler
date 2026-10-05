import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CalendarDays, Download, FileSpreadsheet } from 'lucide-react';
import { withManager } from '@/db/client';
import { requireManager } from '@/lib/auth/session';
import { currentDate, isMonth, monthRange, monthTitle } from '@/lib/month';
import { getMonthPlan } from '@/lib/monthPlan/plan';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/EmptyState';
import { MoreMenu } from '@/components/MoreMenu';
import { PageHeader } from '@/components/PageHeader';
import { StatusBadge } from '@/components/StatusBadge';
import { AddPlanEventDialog } from './AddPlanEventDialog';
import { PlanView } from './PlanView';
import { PublishButton } from './PublishButton';
import { DistributeMonth, DistributeMonthButton, DistributeMonthMenuItem } from './DistributeMonth';

export default async function PlanPage({ params }: { params: Promise<{ month: string }> }) {
  await requireManager();
  const { month } = await params;
  if (!isMonth(month)) notFound();
  const plan = await withManager((tx) => getMonthPlan(tx, month));
  if (!plan) notFound();
  // Распределять есть что, только если в месяце есть мероприятия и он не прошёл (последний день ≥ сегодня по Москве):
  // окно берёт мероприятия с сегодняшнего дня. Кого и куда — покажет окно.
  const distributable = plan.columns.length > 0 && monthRange(month).to > currentDate();

  return (
    <>
      <PageHeader
        title={`Таблица · ${monthTitle(month)}`}
        breadcrumbs={[{ href: `/month?month=${month}`, label: monthTitle(month) }]}
        subtitle={plan.status === 'draft'
          ? <StatusBadge tone="warning">Черновик</StatusBadge>
          : <StatusBadge tone="success">Опубликован</StatusBadge>}
        actions={
          // «Распределить по должностям» — в шапке от 1280 px (уже четыре кнопки не помещаются), ниже — в «⋯».
          <DistributeMonth month={month}>
            <div className="hidden md:contents">
              {distributable && <DistributeMonthButton className="hidden xl:inline-flex" />}
              <Button asChild variant="outline" className="h-11 lg:h-9">
                <Link href={`/month/new?month=${month}`}><FileSpreadsheet aria-hidden="true" />Загрузить расписание снова</Link>
              </Button>
              <Button asChild variant="outline" className="h-11 lg:h-9">
                <a href={`/month/${month}/export`} download><Download aria-hidden="true" />Скачать</a>
              </Button>
            </div>
            <MoreMenu
              className={distributable ? 'size-11 lg:size-9 xl:hidden' : 'size-11 md:hidden'}
              items={[
                { label: 'Загрузить расписание снова', href: `/month/new?month=${month}`, icon: FileSpreadsheet, className: 'md:hidden' },
                { label: 'Скачать', href: `/month/${month}/export`, icon: Download, download: true, className: 'md:hidden' },
              ]}
            >
              {distributable && <DistributeMonthMenuItem />}
            </MoreMenu>
            {plan.status === 'draft' && <PublishButton month={month} events={plan.columns.length} />}
          </DistributeMonth>
        }
      />
      {plan.columns.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title="В месяце пока нет мероприятий"
          description="Добавьте мероприятие или загрузите расписание."
          action={<AddPlanEventDialog month={month} types={plan.eventTypeOptions} variant="outline" />}
        />
      ) : (
        <PlanView plan={plan} />
      )}
    </>
  );
}
