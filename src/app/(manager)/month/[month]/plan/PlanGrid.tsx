'use client';

import { useRef } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDate } from '@/lib/format';
import type { MonthPlan } from '@/lib/monthPlan/plan';
import {
  AUTO_ARRIVE_TITLE, cellKey, fieldKey, PLAN_FIELDS, planFieldDisplay, planFieldValue,
} from '@/lib/monthPlan/planView';
import { AddPlanEventDialog } from './AddPlanEventDialog';
import { FieldCell } from './FieldCell';
import { PersonCell, type Direction } from './PersonCell';
import { ShiftCountsList } from './ShiftCountsList';
import type { PlanEditing } from './usePlanEditing';

const FIELD_ROWS = PLAN_FIELDS.length;

export function PlanGrid({ plan, editing }: { plan: MonthPlan; editing: PlanEditing }) {
  const tableRef = useRef<HTMLTableElement>(null);

  const totalRows = FIELD_ROWS + plan.positions.reduce((sum, p) => sum + p.rows, 0);

  /** Стрелки: ближайшая активная ячейка в направлении. */
  function move(from: string, direction: Direction) {
    const [r, c] = from.split(':').map(Number);
    const [dr, dc] = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] }[direction];
    for (let nr = r + dr, nc = c + dc; nr >= 0 && nr < totalRows && nc >= 0 && nc < plan.columns.length; nr += dr, nc += dc) {
      const target = tableRef.current?.querySelector<HTMLElement>(`[data-cell="${nr}:${nc}"]`);
      if (target) { target.focus(); return; }
    }
  }

  let rowIndex = FIELD_ROWS;
  return (
    <div className="flex items-start gap-4">
      <div data-layout-scroll className="max-h-[calc(100dvh-11rem)] min-w-0 flex-1 overflow-auto rounded-lg border">
        <table ref={tableRef} className="border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-30 w-36 min-w-36 border-b border-r bg-background" />
              {plan.columns.map((c) => (
                <th key={c.eventId} scope="col" className="sticky top-0 z-20 w-40 min-w-40 max-w-40 border-b border-r bg-background p-2 text-left align-top font-normal">
                  <Link href={`/event/${c.eventId}`} className="block rounded-md outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">
                    <span className="block break-words text-xs text-muted-foreground" data-allow-wrap>
                      {formatDate(c.date, { weekday: 'short' })}{` · ${c.eventTypeName}`}
                    </span>
                    <span className="line-clamp-2 break-words font-medium" title={c.concert ?? undefined}>
                      {c.concert ?? 'Без названия'}
                    </span>
                  </Link>
                </th>
              ))}
              <th className="sticky top-0 z-20 border-b bg-background p-2 align-top">
                <AddPlanEventDialog month={plan.month} types={plan.eventTypeOptions} />
              </th>
            </tr>
          </thead>
          <tbody>
            {PLAN_FIELDS.map(([field, label], r) => (
              <tr key={field}>
                <th scope="row" className="sticky left-0 z-10 border-b border-r bg-background px-2 text-left font-medium">{label}</th>
                {plan.columns.map((c, ci) => {
                  return (
                    <FieldCell
                      key={c.eventId}
                      nav={`${r}:${ci}`}
                      value={planFieldValue(c, field)}
                      display={planFieldDisplay(c, field)}
                      label={`${label}, ${formatDate(c.date)}`}
                      title={field === 'arriveTime' && !c.arriveManual ? AUTO_ARRIVE_TITLE : undefined}
                      muted={field === 'arriveTime' && !c.arriveManual}
                      failed={editing.isFailed(fieldKey(c.eventId, field))}
                      onSave={(v) => editing.saveField(c, field, v)}
                      move={(d) => move(`${r}:${ci}`, d)}
                    />
                  );
                })}
                <td className="border-b" />
              </tr>
            ))}
            {plan.positions.flatMap((p) => Array.from({ length: p.rows }, (_, row) => {
              const r = rowIndex++;
              return (
                <tr key={`${p.id}:${row}`}>
                  <th scope="row" className="sticky left-0 z-10 border-b border-r bg-background px-2 text-left font-medium">
                    {p.name}{p.rows > 1 ? ` ${row + 1}` : ''}
                  </th>
                  {plan.columns.map((c, ci) => {
                    const person = editing.personAt(c.eventId, p.id, row);
                    const key = cellKey(c.eventId, p.id, row);
                    return (
                      <PersonCell
                        key={c.eventId}
                        nav={`${r}:${ci}`}
                        person={person}
                        active={row < (plan.quantity[c.eventId]?.[p.id] ?? 0) || person !== null}
                        pending={editing.isPending(key)}
                        failed={editing.isFailed(key)}
                        workers={plan.workers}
                        signups={editing.signupsOf(c.eventId)}
                        shifts={editing.shifts}
                        busy={editing.busyOn(c.eventId)}
                        onPick={(w) => editing.pick(c, p.id, row, w)}
                        onAdd={(name) => editing.addWorker(c, p.id, row, name)}
                        onClear={() => editing.clear(c, p.id, row)}
                        move={(d) => move(`${r}:${ci}`, d)}
                      />
                    );
                  })}
                  <td className="border-b" />
                </tr>
              );
            }))}
          </tbody>
        </table>
      </div>

      <aside className="hidden w-60 shrink-0 xl:block">
        <Card>
          <CardHeader><CardTitle className="text-sm">Смены в месяце</CardTitle></CardHeader>
          <CardContent>
            <ShiftCountsList counts={editing.counts} names={editing.names} />
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}
