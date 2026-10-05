'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { withManager } from '@/db/client';
import { requireManager } from '@/lib/auth/session';
import { parseEventForm, createEvent } from '@/lib/events';
import { userMessage } from '@/lib/errors';
import { feedUrls, originFromHeaders } from '@/lib/calendar/urls';
import { AlreadyConnectedError, issueManagerFeed, managerFeedPath } from '@/lib/calendar/feedKeys';

export type FormState = { error: string | null };

export async function createEventAction(_prev: FormState, form: FormData): Promise<FormState> {
  await requireManager();
  let id: string;
  try {
    const input = parseEventForm(form);
    id = await withManager((tx) => createEvent(tx, input));
  } catch (error) {
    return { error: userMessage(error) };
  }
  redirect(`/event/${id}`);
}

/** Ключ подписки на все мероприятия. Уже выданный ключ заменяется только при `replace`: прежняя ссылка перестаёт работать. */
export async function connectManagerCalendarAction(replace: boolean): Promise<{
  error: string | null;
  urls: { https: string; webcal: string; google: string } | null;
  /** true — ключ уже выдан, а замена не запрошена: окно переходит в состояние «подключён». */
  connected?: true;
}> {
  await requireManager();
  try {
    const token = await withManager((tx) => issueManagerFeed(tx, replace === true));
    revalidatePath('/month');
    return { error: null, urls: feedUrls(originFromHeaders(await headers()), managerFeedPath(token)) };
  } catch (error) {
    if (error instanceof AlreadyConnectedError) return { error: error.message, urls: null, connected: true };
    return { error: userMessage(error), urls: null };
  }
}
