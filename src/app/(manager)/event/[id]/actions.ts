'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { withManager } from '@/db/client';
import { requireManager } from '@/lib/auth/session';
import { isUuid } from '@/lib/ids';
import { parseQuantity } from '@/lib/quantity';
import { userMessage } from '@/lib/errors';
import { currentDate } from '@/lib/month';
import { parseRate, parseEventForm, updateEvent, deleteEvent } from '@/lib/events';
import { applyEventTemplate } from '@/lib/eventTypes/applyTemplate';
import { applyDistribution, previewDistribution, type DistributionPlan } from '@/lib/distribute/operations';
import { secureRandomInt } from '@/lib/distribute/random';
import { parseDistributionRows, type DistributionRow } from '@/lib/distribute/rows';
import {
  setSlot, assignWorker, unassignWorker, setPersonRate,
  acceptSignup, rejectSignup, resolveCancel,
} from './operations';

export type ActionResult = { error: string | null };

/** Все id приходят из браузера: формат проверяется до обращения к базе. */
async function run(
  eventId: string, ids: Array<string | null>, work: (eventId: string) => Promise<unknown>,
): Promise<ActionResult> {
  await requireManager();
  if (![eventId, ...ids].every((id) => id === null || isUuid(id))) {
    return { error: 'Некорректный запрос' };
  }
  try {
    await work(eventId);
  } catch (error) {
    return { error: userMessage(error) };
  }
  revalidatePath(`/event/${eventId}`);
  return { error: null };
}

export async function assignAction(eventId: string, workerId: string, positionId: string | null) {
  return run(eventId, [workerId, positionId], () =>
    withManager((tx) => assignWorker(tx, { eventId, workerId, positionId })));
}

export async function unassignAction(eventId: string, workerId: string) {
  return run(eventId, [workerId], () =>
    withManager((tx) => unassignWorker(tx, { eventId, workerId })));
}

export async function setSlotAction(eventId: string, positionId: string, form: FormData) {
  return run(eventId, [positionId], () => {
    const quantity = parseQuantity(form.get('quantity'));
    const rate = parseRate(form.get('rate'));
    return withManager((tx) => setSlot(tx, { eventId, positionId, quantity, rate }));
  });
}

export async function setPersonRateAction(eventId: string, workerId: string, form: FormData) {
  return run(eventId, [workerId], () => {
    const rate = parseRate(form.get('rate'));
    return withManager((tx) => setPersonRate(tx, { eventId, workerId, rate }));
  });
}

export async function acceptSignupAction(eventId: string, signupId: string, positionId: string | null) {
  return run(eventId, [signupId, positionId], () =>
    withManager((tx) => acceptSignup(tx, { signupId, positionId })));
}

export async function rejectSignupAction(eventId: string, signupId: string) {
  return run(eventId, [signupId], () => withManager((tx) => rejectSignup(tx, signupId)));
}

export async function resolveCancelAction(eventId: string, workerId: string, approve: boolean) {
  // approve приходит из браузера: одобряет только настоящий true, не строка "false".
  return run(eventId, [workerId], () =>
    withManager((tx) => resolveCancel(tx, { eventId, workerId, approve: approve === true })));
}

/**
 * Состав по шаблону вида (только будущее мероприятие); обновляет и месяц, и виды.
 * `applied: 0` — состав уже совпадал (например, выровнял другой менеджер).
 */
export async function applyEventTemplateAction(eventId: string): Promise<ActionResult & { applied: number }> {
  await requireManager();
  if (!isUuid(eventId)) return { error: 'Некорректный запрос', applied: 0 };
  let result;
  try {
    result = await withManager((tx) => applyEventTemplate(tx, eventId, currentDate()));
  } catch (error) {
    return { error: userMessage(error), applied: 0 };
  }
  revalidatePath(`/event/${eventId}`);
  revalidatePath('/month');
  for (const month of result.months) revalidatePath(`/month/${month}/plan`);
  revalidatePath('/event-types');
  return { error: null, applied: result.applied };
}

export type DistributePreviewResult = { error: string | null; preview: DistributionPlan[] | null };
export type DistributeApplyResult = ActionResult & { applied: number; skipped: number };

/** Случайный вариант распределения людей без должности по свободным местам мероприятия. Ничего не пишет. */
export async function previewDistributeEventAction(eventId: string): Promise<DistributePreviewResult> {
  await requireManager();
  if (!isUuid(eventId)) return { error: 'Некорректный запрос', preview: null };
  try {
    return { error: null, preview: await withManager((tx) => previewDistribution(tx, { eventId }, secureRandomInt)) };
  } catch (error) {
    return { error: userMessage(error), preview: null };
  }
}

/**
 * Записывает показанное в окне (мероприятие или месяц). Строки из браузера: форма, uuid и длина —
 * здесь, всё остальное проверяется заново в транзакции; не прошедшие проверку пропускаются.
 */
export async function applyDistributionAction(rows: DistributionRow[]): Promise<DistributeApplyResult> {
  await requireManager();
  let parsed: DistributionRow[];
  try {
    parsed = parseDistributionRows(rows);
  } catch (error) {
    return { error: userMessage(error), applied: 0, skipped: 0 };
  }
  let result;
  try {
    result = await withManager((tx) => applyDistribution(tx, parsed));
  } catch (error) {
    return { error: userMessage(error), applied: 0, skipped: 0 };
  }
  revalidatePath('/event/[id]', 'page');
  revalidatePath('/month');
  for (const month of result.months) revalidatePath(`/month/${month}/plan`);
  return { error: null, applied: result.applied, skipped: result.skipped };
}

/**
 * eventId — из скрытого поля формы, а не через .bind: связанный action внутри
 * useActionState без JS (отправка до гидратации) вешает сервер Next 16.3.6
 * (проверено вручную, см. .superpowers/sdd/final-fix-report.md, «Второй круг»).
 * Значение из формы так же недоверенное, как и аргумент — формат проверяется.
 */
export async function updateEventAction(_prev: ActionResult, form: FormData) {
  return run(String(form.get('eventId') ?? ''), [], (eventId) => {
    const input = parseEventForm(form);
    return withManager((tx) => updateEvent(tx, eventId, input));
  });
}

export async function deleteEventAction(eventId: string): Promise<ActionResult> {
  await requireManager();
  if (!isUuid(eventId)) return { error: 'Некорректный запрос' };
  try {
    await withManager((tx) => deleteEvent(tx, eventId));
  } catch (error) {
    return { error: userMessage(error) };
  }
  // redirect() бросает управляющее исключение — вне try/catch, чтобы не проглотить его.
  redirect('/month');
}
