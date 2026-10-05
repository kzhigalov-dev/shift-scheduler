import { withManager } from '@/db/client';
import { requireManager } from '@/lib/auth/session';
import { currentMonth, isMonth, monthTitle, shiftMonth } from '@/lib/month';
import { listEventTypes } from '@/lib/eventTypes/operations';
import { TAG_LABELS } from '@/lib/eventTags';
import { monthInfo } from '@/lib/monthPlan/months';
import { PageHeader } from '@/components/PageHeader';
import { NewMonthFlow } from './NewMonthFlow';

export default async function NewMonthPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string | string[] }>;
}) {
  await requireManager();
  const raw = (await searchParams).month;
  const month = typeof raw === 'string' && isMonth(raw) ? raw : shiftMonth(currentMonth(), 1);
  const [info,types] = await withManager(async tx=>[await monthInfo(tx,month),await listEventTypes(tx)] as const);
  const typeNames = {...TAG_LABELS};
  for (const t of types) if (t.systemTag !== null) typeNames[t.systemTag]=t.name;

  return (
    <>
      <PageHeader
        title="Новый месяц"
        breadcrumbs={[{ href: `/month?month=${month}`, label: monthTitle(month) }]}
      />
      <NewMonthFlow key={month} month={month} status={info.status} events={info.events} typeNames={typeNames} />
    </>
  );
}
