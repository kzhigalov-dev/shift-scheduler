'use server';

import { redirect } from 'next/navigation';
import { withManager } from '@/db/client';
import { requireManager } from '@/lib/auth/session';
import { userMessage } from '@/lib/errors';
import { isMonth } from '@/lib/month';
import { createDraftMonth } from '@/lib/monthPlan/months';

export async function createEmptyMonthAction(month: string): Promise<{ error: string | null }> {
  await requireManager();
  if (typeof month !== 'string' || !isMonth(month)) return { error: 'Некорректный запрос' };
  try {
    await withManager((tx) => createDraftMonth(tx, month, []));
  } catch (error) {
    return { error: userMessage(error) };
  }
  // redirect() бросает управляющее исключение — вне try/catch.
  redirect(`/month/${month}/plan`);
}
