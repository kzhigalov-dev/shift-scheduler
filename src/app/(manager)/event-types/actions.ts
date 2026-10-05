'use server';
import { revalidatePath } from 'next/cache';
import { withManager } from '@/db/client';
import { requireManager } from '@/lib/auth/session';
import { userMessage } from '@/lib/errors';
import { isUuid } from '@/lib/ids';
import { currentDate } from '@/lib/month';
import { parseTypeForm } from '@/lib/eventTypes/validation';
import { saveEventType, setEventTypeArchived } from '@/lib/eventTypes/operations';
import { previewTypeApply, applyTypeTemplate, type TypeApplyPreview } from '@/lib/eventTypes/applyTemplate';
export type TypeActionResult = { error: string | null; id: string | null };
export type ApplyPreviewResult = { error: string | null; preview: TypeApplyPreview | null };
export type ApplyTypeResult = { error: string | null; applied: number };
const BAD_TYPE = 'Некорректный вид мероприятия';
function refreshTypes(): void {
  revalidatePath('/event-types');
  revalidatePath('/month');
  revalidatePath('/month/new');
  revalidatePath('/month/[month]/plan','page');
  revalidatePath('/event/[id]','page');
  revalidatePath('/pay');
  revalidatePath('/shifts');
  revalidatePath('/earnings');
  revalidatePath('/calendar');
}
export async function saveEventTypeAction(form: FormData): Promise<TypeActionResult> {
  await requireManager();
  try {
    const input = parseTypeForm(form);
    const id = await withManager(tx=>saveEventType(tx,input));
    refreshTypes();
    return {error:null,id};
  } catch (error) { return {error:userMessage(error),id:null}; }
}
export async function archiveEventTypeAction(id: string, archived: boolean): Promise<TypeActionResult> {
  await requireManager();
  try {
    await withManager(tx=>setEventTypeArchived(tx,id,archived));
    refreshTypes();
    return {error:null,id};
  } catch (error) { return {error:userMessage(error),id:null}; }
}
/** Что изменит шаблон в будущих мероприятиях вида. «Сегодня» — по Москве. Ничего не пишет. */
export async function previewApplyTypeAction(typeId: string): Promise<ApplyPreviewResult> {
  await requireManager();
  if (!isUuid(typeId)) return {error:BAD_TYPE,preview:null};
  try {
    return {error:null,preview:await withManager(tx=>previewTypeApply(tx,typeId,currentDate()))};
  } catch (error) { return {error:userMessage(error),preview:null}; }
}
export async function applyTypeTemplateAction(typeId: string): Promise<ApplyTypeResult> {
  await requireManager();
  if (!isUuid(typeId)) return {error:BAD_TYPE,applied:0};
  try {
    const result = await withManager(tx=>applyTypeTemplate(tx,typeId,currentDate()));
    revalidatePath('/event-types');
    revalidatePath('/month');
    for (const month of result.months) revalidatePath(`/month/${month}/plan`);
    if (result.applied > 0) revalidatePath('/event/[id]','page');
    return {error:null,applied:result.applied};
  } catch (error) { return {error:userMessage(error),applied:0}; }
}
