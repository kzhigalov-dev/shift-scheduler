'use server';

import { revalidatePath } from 'next/cache';
import { withManager } from '@/db/client';
import { requireManager } from '@/lib/auth/session';
import { isUuid } from '@/lib/ids';
import { userMessage } from '@/lib/errors';
import {
  createWorker, updateWorker, issueToken, archiveWorker, restoreWorker, parsePhone,
} from './operations';

export type ActionResult = { error: string | null };
export type TokenActionResult = { token: string | null; error: string | null };

export async function createWorkerAction(
  _prev: ActionResult, form: FormData,
): Promise<ActionResult> {
  await requireManager();
  try {
    const fullName = String(form.get('fullName') ?? '');
    const phone = parsePhone(form.get('phone'));
    await withManager((tx) => createWorker(tx, { fullName, phone }));
  } catch (error) {
    return { error: userMessage(error) };
  }
  revalidatePath('/workers');
  return { error: null };
}

/**
 * id — из скрытого поля формы, а не через .bind: связанный action внутри
 * useActionState без JS (отправка до гидратации) вешает сервер Next 16.3.6
 * (проверено вручную, см. .superpowers/sdd/final-fix-report.md, «Второй круг»).
 * Значение из формы так же недоверенное, как и аргумент — формат проверяется.
 */
export async function updateWorkerAction(
  _prev: ActionResult, form: FormData,
): Promise<ActionResult> {
  await requireManager();
  const id = String(form.get('id') ?? '');
  if (!isUuid(id)) return { error: 'Некорректный запрос' };
  try {
    const fullName = String(form.get('fullName') ?? '');
    const phone = parsePhone(form.get('phone'));
    await withManager((tx) => updateWorker(tx, { id, fullName, phone }));
  } catch (error) {
    return { error: userMessage(error) };
  }
  revalidatePath('/workers');
  return { error: null };
}

/** Токен возвращается ровно один раз — клиент показывает его и не сохраняет. */
export async function issueTokenAction(workerId: string): Promise<TokenActionResult> {
  await requireManager();
  if (!isUuid(workerId)) return { token: null, error: 'Некорректный запрос' };
  try {
    const token = await withManager((tx) => issueToken(tx, workerId));
    revalidatePath('/workers');
    return { token, error: null };
  } catch (error) {
    return { token: null, error: userMessage(error) };
  }
}

export async function archiveWorkerAction(workerId: string): Promise<ActionResult> {
  await requireManager();
  if (!isUuid(workerId)) return { error: 'Некорректный запрос' };
  try {
    await withManager((tx) => archiveWorker(tx, workerId));
  } catch (error) {
    return { error: userMessage(error) };
  }
  revalidatePath('/workers');
  return { error: null };
}

export async function restoreWorkerAction(workerId: string): Promise<ActionResult> {
  await requireManager();
  if (!isUuid(workerId)) return { error: 'Некорректный запрос' };
  try {
    await withManager((tx) => restoreWorker(tx, workerId));
  } catch (error) {
    return { error: userMessage(error) };
  }
  revalidatePath('/workers');
  return { error: null };
}
