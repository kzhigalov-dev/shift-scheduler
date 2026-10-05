'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { withWorker } from '@/db/client';
import { requireWorker } from '@/lib/auth/session';
import { isUuid } from '@/lib/ids';
import { userMessage } from '@/lib/errors';
import { feedUrls, originFromHeaders } from '@/lib/calendar/urls';
import { AlreadyConnectedError, issueWorkerFeed, workerFeedPath } from '@/lib/calendar/feedKeys';
import { createSignup, withdrawSignup, requestCancel } from './queries';

export type ActionResult = { error: string | null };

/**
 * eventId приходит из браузера: формат проверяется до обращения к базе.
 * workerId — только из сессии, никогда из аргументов действия.
 */
async function run(
  eventId: string, path: string, work: (workerId: string) => Promise<unknown>,
): Promise<ActionResult> {
  const worker = await requireWorker();
  if (!isUuid(eventId)) return { error: 'Некорректный запрос' };
  try {
    await work(worker.id);
  } catch (error) {
    return { error: userMessage(error) };
  }
  revalidatePath(path);
  return { error: null };
}

export async function signupAction(eventId: string): Promise<ActionResult> {
  return run(eventId, '/available', (workerId) =>
    withWorker(workerId, (tx) => createSignup(tx, { workerId, eventId })));
}

export async function withdrawAction(eventId: string): Promise<ActionResult> {
  return run(eventId, '/available', (workerId) =>
    withWorker(workerId, (tx) => withdrawSignup(tx, { workerId, eventId })));
}

export async function requestCancelAction(eventId: string): Promise<ActionResult> {
  return run(eventId, '/shifts', (workerId) =>
    withWorker(workerId, (tx) => requestCancel(tx, eventId)));
}

export type CalendarResult = {
  error: string | null;
  urls: { https: string; webcal: string; google: string } | null;
  /** true — ключ уже выдан, а замена не запрошена: окно переходит в состояние «подключён». */
  connected?: true;
};

/** Ключ подписки на свои смены. Уже выданный ключ заменяется только при `replace`: прежняя ссылка перестаёт работать. */
export async function connectCalendarAction(replace: boolean): Promise<CalendarResult> {
  const worker = await requireWorker();
  try {
    // replace приходит из браузера: заменой считается только строгое true.
    const token = await withWorker(worker.id, (tx) => issueWorkerFeed(tx, worker.id, replace === true));
    revalidatePath('/shifts');
    return { error: null, urls: feedUrls(originFromHeaders(await headers()), workerFeedPath(token)) };
  } catch (error) {
    if (error instanceof AlreadyConnectedError) return { error: error.message, urls: null, connected: true };
    return { error: userMessage(error), urls: null };
  }
}
