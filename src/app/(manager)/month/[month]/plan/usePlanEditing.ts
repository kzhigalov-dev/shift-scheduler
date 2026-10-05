'use client';

import { startTransition, useRef, useState } from 'react';
import { useRunAction } from '@/components/useRunAction';
import type { MonthPlan, PlanColumn, PlanPerson } from '@/lib/monthPlan/plan';
import {
  busyOn as busyOnPlan, cellKey, effectivePerson, eventPlaces, fieldKey, isEventFull, shiftTotals, sortedCounts,
  type Override, type PlanField,
} from '@/lib/monthPlan/planView';
import { addWorkerToCellAction, setCellAction, setEventFieldAction } from './actions';

/**
 * Правка таблицы расстановки — общая для таблицы и карточек: запись ячейки,
 * неподтверждённые правки (с номером запроса), «Отменить», красные ячейки.
 */
export function usePlanEditing(plan: MonthPlan) {
  const [, run] = useRunAction();
  const [overrides, setOverrides] = useState<ReadonlyMap<string, Override>>(new Map());
  // Ключи ячеек (и полей `field:…`), чья последняя запись не удалась.
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  // Номер последнего запроса по ключу: ответ старого запроса не трогает правку нового.
  const nextToken = useRef(0);
  const latest = useRef(new Map<string, number>());

  const personAt = (eventId: string, positionId: string, row: number) =>
    effectivePerson(plan, overrides, eventId, positionId, row);
  const { counts: shifts, names } = shiftTotals(plan, overrides);

  /** Новый запрос по ключу; его номер становится последним. */
  function begin(key: string): number {
    const token = ++nextToken.current;
    latest.current.set(key, token);
    return token;
  }

  /**
   * Ответ запроса: снять правку и отметить ошибку — только если после него
   * по этому ключу ничего не записывали. Переход (transition) — чтобы снятие
   * правки попало в тот же кадр, что и свежий `plan` с сервера, без мигания.
   */
  function settle(key: string, token: number, error: boolean) {
    if (latest.current.get(key) !== token) return;
    latest.current.delete(key);
    startTransition(() => {
      setOverrides((m) => {
        if (m.get(key)?.token !== token) return m;
        const next = new Map(m);
        next.delete(key);
        return next;
      });
      setFailed((s) => {
        if (s.has(key) === error) return s;
        const next = new Set(s);
        if (error) next.add(key); else next.delete(key);
        return next;
      });
    });
  }

  function put(c: PlanColumn, positionId: string, row: number, person: PlanPerson | null) {
    const key = cellKey(c.eventId, positionId, row);
    const token = begin(key);
    setOverrides((m) => new Map(m).set(key, { person, token }));
    return { key, token };
  }

  /** Записать человека в ячейку; previousWorkerId — кто там сейчас (по мнению клиента). */
  function assign(c: PlanColumn, positionId: string, row: number, previousWorkerId: string | null,
    worker: PlanPerson, success: string | null) {
    const { key, token } = put(c, positionId, row, worker);
    run(() => setCellAction(plan.month, c.eventId, positionId, row, previousWorkerId, worker.workerId),
      success, () => settle(key, token, false), { onError: () => settle(key, token, true) });
  }

  function pick(c: PlanColumn, positionId: string, row: number, worker: PlanPerson) {
    const prev = personAt(c.eventId, positionId, row);
    if (prev?.workerId === worker.workerId) return;
    assign(c, positionId, row, prev?.workerId ?? null, worker, null);
  }

  function addWorker(c: PlanColumn, positionId: string, row: number, name: string) {
    const prev = personAt(c.eventId, positionId, row);
    const { key, token } = put(c, positionId, row, { workerId: `new:${name}`, fullName: name });
    run(() => addWorkerToCellAction(plan.month, c.eventId, positionId, row, prev?.workerId ?? null, name),
      `Добавлен работник «${name}»`, () => settle(key, token, false), { onError: () => settle(key, token, true) });
  }

  function clear(c: PlanColumn, positionId: string, row: number) {
    const prev = personAt(c.eventId, positionId, row);
    if (!prev) return;
    const { key, token } = put(c, positionId, row, null);
    run(() => setCellAction(plan.month, c.eventId, positionId, row, prev.workerId, null),
      'Ячейка очищена', () => settle(key, token, false), {
        onError: () => settle(key, token, true),
        // Кнопка срабатывает после записи: ячейка на сервере уже пуста. personAt здесь
        // из устаревшего рендера (видит prev), поэтому — assign с явным «было пусто».
        action: { label: 'Отменить', onClick: () => assign(c, positionId, row, null, prev, null) },
      });
  }

  function saveField(c: PlanColumn, field: PlanField, value: string) {
    const key = fieldKey(c.eventId, field);
    const token = begin(key);
    run(() => setEventFieldAction(plan.month, c.eventId, field, value), null,
      () => settle(key, token, false), { onError: () => settle(key, token, true) });
  }

  return {
    personAt,
    isPending: (key: string) => overrides.has(key),
    isFailed: (key: string) => failed.has(key),
    shifts,
    names,
    counts: sortedCounts(shifts, names),
    busyOn: (eventId: string) => busyOnPlan(plan, overrides, eventId),
    signupsOf: (eventId: string) => new Set(plan.signups[eventId] ?? []),
    places: (eventId: string) => eventPlaces(plan, overrides, eventId),
    isFull: (eventId: string) => isEventFull(plan, overrides, eventId),
    pick,
    addWorker,
    clear,
    saveField,
  };
}

export type PlanEditing = ReturnType<typeof usePlanEditing>;
