import { crossSiteResponse, isSameOrigin } from '@/lib/http/sameOrigin';
import { isManager } from '@/lib/auth/session';
import { withManager } from '@/db/client';
import { readInputWorkbook } from '@/lib/import/inputWorkbook';
import { importDbSnapshot } from '@/lib/import/snapshot';
import { scheduleSheets, type ScheduleSheet } from '@/lib/schedule/parseSchedule';
import { previewSchedule } from '@/lib/monthPlan/preview';
import { isMonth, monthTitle } from '@/lib/month';
import { userMessage } from '@/lib/errors';
import { previewSheets } from '@/lib/import/prepare';
import type { WorkbookSheet } from '@/lib/import/workbook';

/** Листы расписания выбранного месяца; для месяца с мероприятиями — ещё и разница с базой. */
export async function POST(request: Request) {
  if (!(await isManager())) return Response.json({ error: 'Нужен вход менеджера' }, { status: 401 });
  if (!isSameOrigin(request)) return crossSiteResponse();
  const form = await request.formData();
  const month = String(form.get('month') ?? '');
  if (!isMonth(month)) return Response.json({ error: 'Неверный месяц' }, { status: 400 });
  let sheets: ScheduleSheet[];
  let workbook: WorkbookSheet[];
  try {
    workbook = (await readInputWorkbook(form, 'schedule')).sheets;
    sheets = scheduleSheets(workbook).filter((s) => s.month === month);
  } catch (error) {
    // userMessage: у UserError — её текст, прочее — в лог и общий текст.
    return Response.json({ error: userMessage(error, 'Не удалось прочитать файл — это точно .xlsx?') }, { status: 400 });
  }
  if (sheets.length === 0 && previewSheets(workbook).some((s) => s.events.length > 0)) {
    return Response.json({
      error: 'Это таблица с работниками, а не расписание мероприятий. Её загружают в «Импорт».',
    }, { status: 400 });
  }
  if (sheets.length === 0) {
    return Response.json(
      { error: `В файле нет листа расписания за ${monthTitle(month).toLowerCase()}` }, { status: 400 });
  }
  // Лист месяца заведён заранее (дни проставлены), а мероприятий Анненкирхе в нём ещё нет.
  const filled = sheets.filter((s) => s.events.length > 0);
  if (filled.length === 0) {
    return Response.json({
      error: `Лист «${sheets[0].name}» есть, но мероприятий Анненкирхе в нём пока нет. `
        + 'Заполните расписание или создайте пустой месяц.',
    }, { status: 400 });
  }
  sheets = filled;

  try {
    return Response.json(await withManager(async tx => ({
      ...await previewSchedule(tx,month,sheets),
      dbSnapshot: form.get('source') === 'schedule' ? await importDbSnapshot(tx) : null,
    }), { isolation: 'repeatable read' }), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: userMessage(error) }, { status: 400 });
  }
}
