import { withManager } from '@/db/client';
import { isManager } from '@/lib/auth/session';
import { monthParam, monthTitle } from '@/lib/month';
import { userMessage } from '@/lib/errors';
import { payForMonth } from '../queries';
import { buildPayWorkbook } from './buildPayWorkbook';

/** Выгрузка не кешируется нигде — в ней персональные данные оплаты. */
const NO_STORE = { 'Cache-Control': 'no-store' };

/** Выгрузка оплаты за месяц в .xlsx. Route Handler сам проверяет права — раскладка их не защищает. */
export async function GET(request: Request) {
  if (!(await isManager())) {
    return new Response('Нужен вход менеджера', { status: 401, headers: NO_STORE });
  }

  const month = monthParam(new URL(request.url).searchParams.get('month') ?? undefined);

  try {
    const { rows, details } = await withManager((tx) => payForMonth(tx, month));
    const wb = buildPayWorkbook(month, rows, details);

    // writeBuffer() в типах exceljs объявлен как Promise<Buffer>, где Buffer —
    // локальный (неэкспортируемый) тип этого пакета «extends ArrayBuffer»;
    // в рантайме это настоящий Node Buffer (т.е. Uint8Array). Response
    // принимает BodyInit из lib.dom, который об этом типе ничего не знает.
    // Оборачиваем честно в Uint8Array — работает для обоих случаев
    // (ArrayBuffer или TypedArray на входе даёт корректные байты), без any.
    const raw = await wb.xlsx.writeBuffer();
    const body = new Uint8Array(raw);

    const filename = encodeURIComponent(`Оплата ${monthTitle(month)}.xlsx`);
    return new Response(body, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="oplata-${month}.xlsx"; filename*=UTF-8''${filename}`,
        ...NO_STORE,
      },
    });
  } catch (error) {
    return new Response(userMessage(error, 'Не удалось сформировать выгрузку'), {
      status: 500,
      headers: NO_STORE,
    });
  }
}
