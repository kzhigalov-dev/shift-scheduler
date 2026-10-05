import { crossSiteResponse, isSameOrigin } from '@/lib/http/sameOrigin';
import { withManager } from '@/db/client';
import { previewImportTypes } from '@/lib/eventTypes/importChecks';
import { userMessage } from '@/lib/errors';
import { isManager } from '@/lib/auth/session';
import { readInputWorkbook } from '@/lib/import/inputWorkbook';
import { previewGoogleStaffReview } from '@/lib/import/snapshot';
import { parseSelection, scheduleMonthsInstead, SCHEDULE_FILE_MESSAGE } from '@/lib/import/prepare';

export async function POST(request: Request) {
  if (!(await isManager())) return Response.json({ error: 'Нужен вход менеджера' }, { status: 401 });
  if (!isSameOrigin(request)) return crossSiteResponse();
  try {
    const form = await request.formData();
    const { sheets, source } = await readInputWorkbook(form, 'staff');
    const selection = source && form.has('selection') ? parseSelection(JSON.parse(String(form.get('selection')))) : null;
    // Файл расписания сюда кладут по ошибке: вместо «нет строки День недели» на каждом листе — куда его нести.
    const scheduleMonths = scheduleMonthsInstead(sheets);
    if (scheduleMonths.length > 0) {
      return Response.json({ error: SCHEDULE_FILE_MESSAGE, scheduleMonths }, { status: 400 });
    }
    return Response.json(await withManager(async tx => {
      const review = selection ? await previewGoogleStaffReview(tx,sheets,selection) : null;
      return {
        sheets: await previewImportTypes(tx,sheets),
        dbSnapshot: review?.snapshot ?? null,
        positionConflicts: review?.positionConflicts ?? [],
        moves: review?.moves ?? [],
        eventCounts: review?.eventCounts ?? {},
      };
    }, { isolation: 'repeatable read' }), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: userMessage(error,'Не удалось прочитать файл — это точно .xlsx?') }, { status: 400 });
  }
}
