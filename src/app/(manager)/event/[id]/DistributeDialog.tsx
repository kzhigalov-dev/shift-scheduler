'use client';

import { useRef, useState, useTransition } from 'react';
import { unstable_rethrow } from 'next/navigation';
import { Shuffle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useRunAction } from '@/components/useRunAction';
import { overLimit, overLimitLabel, type FreeSlot } from '@/lib/distribute/distribute';
import type { DistributionPlan } from '@/lib/distribute/operations';
import type { DistributionRow } from '@/lib/distribute/rows';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { applyDistributionAction, previewDistributeEventAction, type DistributePreviewResult } from './actions';

const NBSP = ' ';
const NONE = 'none';
const TITLE = 'Распределить по должностям';
const key = (eventId: string, workerId: string) => `${eventId}:${workerId}`;

/**
 * Состояние окна распределения: предпросмотр с сервера (случайность — там же) и правки менеджера.
 * `start` открывает окно и загружает вариант; `shuffle` — новый вариант, правки сбрасываются.
 */
export function useDistribution(load: () => Promise<DistributePreviewResult>) {
  const [open, setOpen] = useState(false);
  const [plans, setPlans] = useState<DistributionPlan[] | null>(null);
  const [choice, setChoice] = useState<Record<string, string | null>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  // Ответ, пришедший после закрытия окна или после следующего «Перемешать», не показывается.
  const session = useRef(0);

  function fetchPlans(fresh: boolean) {
    const mine = ++session.current;
    setError(null);
    if (fresh) setPlans(null);
    startLoading(async () => {
      try {
        const result = await load();
        if (mine !== session.current) return;
        setError(result.error);
        setPlans(result.preview);
        setChoice(Object.fromEntries((result.preview ?? []).flatMap((p) => p.rows.map((r) => [key(p.eventId, r.workerId), r.positionId]))));
      } catch (e) {
        unstable_rethrow(e);
        if (mine === session.current) setError('Не удалось загрузить распределение — попробуйте ещё раз');
      }
    });
  }

  return {
    open, plans, choice, error, loading,
    start() { setOpen(true); fetchPlans(true); },
    shuffle() { fetchPlans(false); },
    setOpen(next: boolean) { setOpen(next); if (!next) session.current += 1; },
    choose(eventId: string, workerId: string, positionId: string | null) {
      setChoice((c) => ({ ...c, [key(eventId, workerId)]: positionId }));
    },
  };
}
export type DistributionState = ReturnType<typeof useDistribution>;

function PersonChoice({ name, value, free, over, onChange }: {
  name: string; value: string | null; free: FreeSlot[]; over: boolean; onChange: (positionId: string | null) => void;
}) {
  const label = value === null ? 'Без должности' : free.find((s) => s.positionId === value)?.name ?? 'Без должности';
  return (
    <li className={cn('flex min-w-0 flex-col gap-1.5 rounded-md border px-2 py-1.5 sm:flex-row sm:items-center sm:gap-3', over && 'border-destructive')}>
      <span title={name} className="min-w-0 truncate sm:flex-1">{name}</span>
      <Select value={value ?? NONE} onValueChange={(v) => onChange(v === NONE ? null : v)}>
        <SelectTrigger
          aria-label={`Должность: ${name}`} aria-invalid={over || undefined}
          className="w-full min-w-0 sm:w-52 sm:shrink-0 data-[size=default]:h-11 lg:data-[size=default]:h-9 *:data-[slot=select-value]:block *:data-[slot=select-value]:truncate"
        >
          <SelectValue>{label}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {free.map((s) => (
            <SelectItem key={s.positionId} value={s.positionId}>{s.name}{NBSP}· мест:{NBSP}{s.free}</SelectItem>
          ))}
          <SelectItem value={NONE}>Без должности</SelectItem>
        </SelectContent>
      </Select>
    </li>
  );
}

/**
 * Окно «Распределить по должностям»: строка на человека с выбором должности (по умолчанию — случайный
 * вариант с сервера), «Перемешать», «Применить». Должность выбрана большему числу людей, чем мест, —
 * строки подсвечены, подпись «На БИЛЕТЫ мест: 3», «Применить» недоступна. `month` — по мероприятиям.
 */
export function DistributeDialog({ mode, state }: { mode: 'event' | 'month'; state: DistributionState }) {
  const [pending, run] = useRunAction();
  const { plans, choice, error, loading } = state;
  const view = (plans ?? []).map((p) => {
    const rows = p.rows.map((r) => ({ ...r, positionId: choice[key(p.eventId, r.workerId)] ?? null }));
    const over = overLimit(rows, p.free);
    return { plan: p, rows, over, overIds: new Set(over.map((o) => o.positionId)) };
  });
  const names = new Map(view.flatMap((v) => v.plan.people.map((p) => [key(v.plan.eventId, p.workerId), p.fullName])));
  const people = view.reduce((n, v) => n + v.plan.people.length, 0);
  const send: DistributionRow[] = view.flatMap((v) => v.rows
    .filter((r) => r.positionId !== null)
    .map((r) => ({ eventId: v.plan.eventId, workerId: r.workerId, positionId: r.positionId })));
  const blocked = view.some((v) => v.over.length > 0);
  // «Применить к N» — мероприятия, по которым уходит хоть одна строка с должностью.
  const targets = new Set(send.map((r) => r.eventId)).size;
  const empty = plans !== null && plans.length === 0;

  function apply() {
    run(() => applyDistributionAction(send),
      (r) => `Распределено: ${r.applied}${r.skipped > 0 ? `, пропущено: ${r.skipped} — состав изменился` : ''}`,
      () => state.setOpen(false));
  }

  return (
    <Dialog open={state.open} onOpenChange={state.setOpen}>
      <DialogContent aria-describedby={undefined} className="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-lg [&>*]:min-w-0">
        <DialogHeader className="min-w-0 pr-8">
          <DialogTitle>{TITLE}</DialogTitle>
        </DialogHeader>
        {plans === null && !error ? <p className="text-muted-foreground">Загружаем…</p>
          : error && plans === null ? <p role="alert" className="text-destructive" data-allow-wrap>{error}</p>
          : empty ? <p data-allow-wrap>Распределять некого: у всех людей уже есть должности или свободных мест нет.</p>
          : <>
            {mode === 'month' && <p className="text-muted-foreground">Мероприятий: {view.length}, людей: {people}</p>}
            {error && <p role="alert" className="text-destructive" data-allow-wrap>{error}</p>}
            <div
              role="region" aria-label="Должности людей" tabIndex={0} data-layout-scroll aria-busy={loading}
              className="min-h-0 overflow-y-auto rounded-lg border outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <ul className="divide-y">
                {view.map(({ plan, rows, over, overIds }) => (
                  <li key={plan.eventId} className="flex flex-col gap-2 p-3">
                    {mode === 'month' && (
                      <p className="break-words font-medium" data-allow-wrap>
                        {formatDate(plan.date, { weekday: 'short' })} · {plan.startTime} · {plan.concert ?? 'Без названия'}
                      </p>
                    )}
                    <ul className="flex flex-col gap-2" aria-label={mode === 'month' ? undefined : 'Люди без должности'}>
                      {rows.map((r) => (
                        <PersonChoice
                          key={r.workerId}
                          name={names.get(key(plan.eventId, r.workerId)) ?? ''}
                          value={r.positionId} free={plan.free}
                          over={r.positionId !== null && overIds.has(r.positionId)}
                          onChange={(positionId) => state.choose(plan.eventId, r.workerId, positionId)}
                        />
                      ))}
                    </ul>
                    <div aria-live="polite" className="flex flex-col gap-0.5 empty:hidden">
                      {over.map((o) => <p key={o.positionId} className="text-destructive">{overLimitLabel(o)}</p>)}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </>}
        <DialogFooter>
          {plans !== null && plans.length > 0 ? <>
            <Button type="button" variant="outline" disabled={loading || pending} onClick={state.shuffle} className="h-11 lg:h-9 sm:mr-auto">
              <Shuffle aria-hidden="true" />Перемешать
            </Button>
            <DialogClose asChild><Button type="button" variant="outline" className="h-11 lg:h-9">Отмена</Button></DialogClose>
            <Button type="button" disabled={loading || pending || blocked || send.length === 0} onClick={apply} className="h-11 lg:h-9">
              {pending ? 'Применяем…' : mode === 'month' ? `Применить к${NBSP}${targets}` : 'Применить'}
            </Button>
          </> : <DialogClose asChild><Button type="button" variant="outline" className="h-11 lg:h-9">Закрыть</Button></DialogClose>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Кнопка в «Без должности» на странице мероприятия. */
export function DistributeEventButton({ eventId }: { eventId: string }) {
  const state = useDistribution(() => previewDistributeEventAction(eventId));
  return (
    <>
      <Button type="button" variant="outline" onClick={state.start} className="mt-1 h-11 self-start lg:h-9">
        <Shuffle aria-hidden="true" />{TITLE}
      </Button>
      <DistributeDialog mode="event" state={state} />
    </>
  );
}
