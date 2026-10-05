import ExcelJS from 'exceljs';
import type { PayRow } from '@/lib/pay/calculatePay';
import { monthTitle } from '@/lib/month';
import type { PayDetail } from '../queries';

/**
 * Строит книгу оплаты за месяц — листы «Итого» (по людям, со строкой «Итого»,
 * включая сумму «Без ставки») и «По сменам» (у смены без ставки в колонке
 * суммы — текст «ставка уточняется», как на странице). Чистая функция, без
 * I/O — сериализацию в буфер делает вызывающий код.
 */
export function buildPayWorkbook(month: string, rows: PayRow[], details: PayDetail[]): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.title = `Оплата ${monthTitle(month)}`;

  const summary = wb.addWorksheet('Итого');
  summary.columns = [
    { header: 'ФИО', key: 'fullName', width: 30 },
    { header: 'Смен', key: 'shifts', width: 8 },
    { header: 'Сумма, ₽', key: 'total', width: 12 },
    { header: 'Без ставки', key: 'unpriced', width: 12 },
  ];
  rows.forEach((r) => summary.addRow(r));
  summary.addRow({
    fullName: 'Итого',
    shifts: rows.reduce((s, r) => s + r.shifts, 0),
    total: rows.reduce((s, r) => s + r.total, 0),
    unpriced: rows.reduce((s, r) => s + r.unpriced, 0),
  });

  const sheet = wb.addWorksheet('По сменам');
  sheet.columns = [
    { header: 'Дата', key: 'date', width: 12 },
    { header: 'Концерт', key: 'concert', width: 28 },
    { header: 'ФИО', key: 'fullName', width: 30 },
    { header: 'Должность', key: 'position', width: 14 },
    { header: 'Сумма, ₽', key: 'amount', width: 12 },
  ];
  details.forEach((d) => sheet.addRow({
    ...d,
    position: d.position ?? 'не расставлен',
    amount: d.amount ?? 'ставка уточняется',
  }));

  return wb;
}
