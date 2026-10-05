import { crossSiteResponse, isSameOrigin } from '@/lib/http/sameOrigin';
import { isManager } from '@/lib/auth/session';
import { withManager } from '@/db/client';
import { readInputWorkbook } from '@/lib/import/inputWorkbook';
import { checkImportSnapshot, requireImportSnapshot } from '@/lib/import/snapshot';
import { scheduleSheets } from '@/lib/schedule/parseSchedule';
import { diffSchedule } from '@/lib/schedule/diff';
import { parseCreateSelection, parseUpdateSelection } from '@/lib/schedule/selection';
import { monthInfo, createDraftMonth, existingForDiff, applyScheduleDiff } from '@/lib/monthPlan/months';
import { isMonth } from '@/lib/month';
import { UserError, userMessage } from '@/lib/errors';

/** Десятки мероприятий с местами в одной транзакции — с запасом, как у старого импорта. */
export const maxDuration = 60;

/** Файл разбирается заново: строкам и разнице из браузера не доверяем, от браузера — только выбор. */
export async function POST(request: Request) {
  if (!(await isManager())) return Response.json({ error: 'Нужен вход менеджера' }, { status: 401 });
  if (!isSameOrigin(request)) return crossSiteResponse();
  const form = await request.formData();
  const month = String(form.get('month') ?? '');
  if (!isMonth(month)) return Response.json({ error: 'Неверный месяц' }, { status: 400 });
  try {
    const sheetName = String(form.get('sheet') ?? '');
    const selection = String(form.get('selection') ?? '');
    const { sheets, source } = await readInputWorkbook(form, 'schedule', true);
    const snapshot = source ? requireImportSnapshot(form.get('snapshot')) : null;
    const sheet = scheduleSheets(sheets)
      .find((s) => s.name === sheetName && s.month === month);
    if (!sheet) throw new UserError('Лист не найден — загрузите файл заново');

    const result = await withManager(async (tx) => {
      if (snapshot) await checkImportSnapshot(tx, snapshot);
      if ((await monthInfo(tx, month)).events === 0) {
        const { keys } = parseCreateSelection(selection);
        const chosen = sheet.events.filter((e) => e.issue === null && keys.includes(e.key));
        if (chosen.length === 0) throw new UserError('Отметьте хотя бы одно мероприятие');
        await createDraftMonth(tx, month, chosen);
        return { mode: 'create' as const, created: chosen.length };
      }
      const diff = diffSchedule(await existingForDiff(tx, month), sheet.events);
      return { mode: 'update' as const, ...(await applyScheduleDiff(tx, month, diff, parseUpdateSelection(selection))) };
    });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    return Response.json({ error: userMessage(error, 'Не удалось применить расписание') }, { status: 400 });
  }
}
