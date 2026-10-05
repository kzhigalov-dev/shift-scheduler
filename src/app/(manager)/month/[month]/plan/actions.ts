'use server';

import { revalidatePath } from 'next/cache';
import { withManager } from '@/db/client';
import { requireManager } from '@/lib/auth/session';
import { isUuid } from '@/lib/ids';
import { currentDate, isMonth } from '@/lib/month';
import { UserError, userMessage } from '@/lib/errors';
import { createEvent, isEventField, parseEventForm, setEventField } from '@/lib/events';
import { publishMonth } from '@/lib/monthPlan/months';
import { setPlanCell } from '@/lib/monthPlan/plan';
import { createWorker } from '@/app/(manager)/workers/operations';
import { previewDistribution } from '@/lib/distribute/operations';
import { secureRandomInt } from '@/lib/distribute/random';
import type { DistributePreviewResult } from '@/app/(manager)/event/[id]/actions';

export type PlanResult = { error: string | null };

/** Месяц и id приходят из браузера: формат проверяется до обращения к базе. */
async function run(month: string, ids: Array<string | null>, work: () => Promise<unknown>): Promise<PlanResult> {
  await requireManager();
  if (typeof month !== 'string' || !isMonth(month) || !ids.every((id) => id === null || isUuid(id))) {
    return { error: 'Некорректный запрос' };
  }
  try {
    await work();
  } catch (error) {
    return { error: userMessage(error) };
  }
  revalidatePath(`/month/${month}/plan`);
  // Счётчики и «Сводка месяца» на /month тоже меняются; опубликовать можно и оттуда.
  revalidatePath('/month');
  return { error: null };
}

export async function setCellAction(
  month: string, eventId: string, positionId: string, row: number,
  previousWorkerId: string | null, workerId: string | null,
): Promise<PlanResult> {
  return run(month, [eventId, positionId, previousWorkerId, workerId], () =>
    withManager((tx) => setPlanCell(tx, { eventId, positionId, row, previousWorkerId, workerId })));
}

/** Нового человека нет в списке: создать работника и сразу вписать. */
export async function addWorkerToCellAction(
  month: string, eventId: string, positionId: string, row: number,
  previousWorkerId: string | null, fullName: string,
): Promise<PlanResult> {
  return run(month, [eventId, positionId, previousWorkerId], () => {
    if (typeof fullName !== 'string' || fullName.length > 100) throw new UserError('Слишком длинное имя');
    return withManager(async (tx) => {
      const workerId = await createWorker(tx, { fullName, phone: null });
      await setPlanCell(tx, { eventId, positionId, row, previousWorkerId, workerId });
    });
  });
}

export async function setEventFieldAction(
  month: string, eventId: string, field: string, value: string,
): Promise<PlanResult> {
  return run(month, [eventId], () => {
    if (typeof field !== 'string' || !isEventField(field) || typeof value !== 'string' || value.length > 20) {
      throw new UserError('Некорректный запрос');
    }
    return withManager((tx) => setEventField(tx, eventId, field, value));
  });
}

export async function publishMonthAction(month: string): Promise<PlanResult> {
  return run(month, [], () => withManager((tx) => publishMonth(tx, month)));
}

/**
 * Новый столбец. month — скрытое поле формы (не .bind — см. AGENTS.md).
 * Первый оператор — `return run(`: так требует tests/access.test.ts.
 */
export async function addPlanEventAction(_prev: PlanResult, form: FormData): Promise<PlanResult> {
  return run(String(form.get('month') ?? ''), [], () => {
    const month = String(form.get('month') ?? '');
    const input = parseEventForm(form);
    if (!input.date.startsWith(`${month}-`)) throw new UserError('Дата не из этого месяца');
    return withManager((tx) => createEvent(tx, input));
  });
}

/**
 * Случайный вариант распределения по мероприятиям месяца с сегодняшнего дня (по Москве).
 * Ничего не пишет; применяет `applyDistributionAction` страницы мероприятия.
 */
export async function previewDistributeMonthAction(month: string): Promise<DistributePreviewResult> {
  await requireManager();
  if (typeof month !== 'string' || !isMonth(month)) return { error: 'Некорректный запрос', preview: null };
  try {
    return { error: null, preview: await withManager((tx) => previewDistribution(tx, { month, today: currentDate() }, secureRandomInt)) };
  } catch (error) {
    return { error: userMessage(error), preview: null };
  }
}
