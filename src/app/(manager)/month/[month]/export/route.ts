import { withManager } from '@/db/client';
import { requireManager } from '@/lib/auth/session';
import { userMessage } from '@/lib/errors';
import { isMonth } from '@/lib/month';
import { loadMonthSheet } from '@/lib/export/loadMonth';
import { buildMonthSheet, exportFileName } from '@/lib/export/monthSheet';
import { writeMonthWorkbook } from '@/lib/export/writeWorkbook';

/** Выгрузка не кешируется нигде — в ней имена людей. */
const NO_STORE = { 'Cache-Control': 'no-store' };
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Таблица месяца (и черновика) в .xlsx — в виде месячного листа исходной таблицы. Права — первой строкой. */
export async function GET(_request: Request, { params }: { params: Promise<{ month: string }> }) {
  await requireManager();
  const { month } = await params;
  if (!isMonth(month)) return new Response(null, { status: 404, headers: NO_STORE });

  try {
    const input = await withManager((tx) => loadMonthSheet(tx, month));
    // Buffer → Uint8Array на ArrayBuffer: такой body Response принимает без приведения типов.
    const body = new Uint8Array(await writeMonthWorkbook(buildMonthSheet(input)));
    const filename = encodeURIComponent(exportFileName(month));
    return new Response(body, {
      headers: {
        'Content-Type': XLSX,
        'Content-Disposition': `attachment; filename="annenkirche-${month}.xlsx"; filename*=UTF-8''${filename}`,
        ...NO_STORE,
      },
    });
  } catch (error) {
    return new Response(userMessage(error, 'Не удалось сформировать выгрузку'), { status: 500, headers: NO_STORE });
  }
}
