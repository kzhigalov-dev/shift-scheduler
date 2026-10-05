import { describe, it, expect } from 'vitest';
import { buildPayWorkbook } from '@/app/(manager)/pay/export/buildPayWorkbook';
import type { PayRow } from '@/lib/pay/calculatePay';
import type { PayDetail } from '@/app/(manager)/pay/queries';

const rows: PayRow[] = [
  { workerId: 'w1', fullName: 'Илья', shifts: 2, total: 3700, unpriced: 0 },
  { workerId: 'w2', fullName: 'Артем', shifts: 1, total: 0, unpriced: 1 },
];

const details: PayDetail[] = [
  { date: '2026-07-09', concert: 'Лунный свет', fullName: 'Илья', position: 'ЗАЛ', amount: 1300 },
  { date: '2026-07-10', concert: null, fullName: 'Илья', position: 'ЗАЛ', amount: 2400 },
  { date: '2026-07-11', concert: null, fullName: 'Артем', position: null, amount: null },
];

describe('buildPayWorkbook', () => {
  it('строит книгу с листами «Итого» и «По сменам»', () => {
    const wb = buildPayWorkbook('2026-07', rows, details);
    expect(wb.worksheets.map((s) => s.name)).toEqual(['Итого', 'По сменам']);
  });

  it('строка «Итого» на листе «Итого» включает сумму «Без ставки»', () => {
    const wb = buildPayWorkbook('2026-07', rows, details);
    const summary = wb.worksheets[0];
    const totalRow = summary.getRow(summary.rowCount);
    expect(totalRow.getCell('fullName').value).toBe('Итого');
    expect(totalRow.getCell('shifts').value).toBe(3);
    expect(totalRow.getCell('total').value).toBe(3700);
    expect(totalRow.getCell('unpriced').value).toBe(1);
  });

  it('строки по людям на листе «Итого» — как в rows', () => {
    const wb = buildPayWorkbook('2026-07', rows, details);
    const summary = wb.worksheets[0];
    expect(summary.getRow(2).getCell('fullName').value).toBe('Илья');
    expect(summary.getRow(2).getCell('unpriced').value).toBe(0);
    expect(summary.getRow(3).getCell('fullName').value).toBe('Артем');
    expect(summary.getRow(3).getCell('unpriced').value).toBe(1);
  });

  it('на листе «По сменам» у смены без ставки в сумме — текст «ставка уточняется»', () => {
    const wb = buildPayWorkbook('2026-07', rows, details);
    const sheet = wb.worksheets[1];
    expect(sheet.getRow(2).getCell('amount').value).toBe(1300);
    expect(sheet.getRow(3).getCell('amount').value).toBe(2400);
    expect(sheet.getRow(4).getCell('amount').value).toBe('ставка уточняется');
    expect(sheet.getRow(4).getCell('position').value).toBe('не расставлен');
  });

  it('пустые rows и details — только заголовки и строка «Итого» с нулями', () => {
    const wb = buildPayWorkbook('2026-07', [], []);
    const summary = wb.worksheets[0];
    expect(summary.rowCount).toBe(2);
    const totalRow = summary.getRow(2);
    expect(totalRow.getCell('shifts').value).toBe(0);
    expect(totalRow.getCell('total').value).toBe(0);
    expect(totalRow.getCell('unpriced').value).toBe(0);
    expect(wb.worksheets[1].rowCount).toBe(1);
  });
});
