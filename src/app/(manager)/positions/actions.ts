'use server';

import { revalidatePath } from 'next/cache';
import { withManager } from '@/db/client';
import { requireManager } from '@/lib/auth/session';
import { isUuid } from '@/lib/ids';
import { userMessage } from '@/lib/errors';
import { parseRate } from '@/lib/events';
import { parseQuantity } from '@/lib/quantity';
import { updatePosition } from './operations';

export type ActionResult = { error: string | null };

/**
 * id — из скрытого поля формы, а не через .bind: связанный action внутри
 * useActionState без JS (отправка до гидратации) вешает сервер Next 16.3.6
 * (проверено вручную, см. .superpowers/sdd/final-fix-report.md, «Второй круг»).
 * Значение из формы так же недоверенное, как и аргумент — формат проверяется.
 */
export async function updatePositionAction(
  _prev: ActionResult, form: FormData,
): Promise<ActionResult> {
  await requireManager();
  const id = String(form.get('id') ?? '');
  if (!isUuid(id)) return { error: 'Некорректный запрос' };
  try {
    const defaultQuantity = parseQuantity(form.get('defaultQuantity'));
    const defaultRate = parseRate(form.get('defaultRate'));
    await withManager((tx) => updatePosition(tx, { id, defaultQuantity, defaultRate }));
  } catch (error) {
    return { error: userMessage(error) };
  }
  revalidatePath('/positions');
  return { error: null };
}
