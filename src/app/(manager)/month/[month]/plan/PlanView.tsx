'use client';

import { Suspense } from 'react';
import type { MonthPlan } from '@/lib/monthPlan/plan';
import { AddPlanEventDialog } from './AddPlanEventDialog';
import { PlanCards } from './PlanCards';
import { PlanGrid } from './PlanGrid';
import { ShiftCountsSheet } from './ShiftCountsSheet';
import { usePlanEditing } from './usePlanEditing';

/** Таблица расстановки: один источник правок — таблица от 768 px, карточки уже. */
export function PlanView({ plan }: { plan: MonthPlan }) {
  const editing = usePlanEditing(plan);
  return (
    <>
      <div className="mb-3 flex flex-wrap justify-end gap-2 xl:hidden">
        <div className="md:hidden"><AddPlanEventDialog month={plan.month} types={plan.eventTypeOptions} variant="outline" /></div>
        <ShiftCountsSheet counts={editing.counts} names={editing.names} />
      </div>
      <div className="hidden md:block"><PlanGrid plan={plan} editing={editing} /></div>
      <div className="md:hidden">
        <Suspense fallback={null}><PlanCards plan={plan} editing={editing} /></Suspense>
      </div>
    </>
  );
}
