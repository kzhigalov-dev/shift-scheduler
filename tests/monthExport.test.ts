import { describe, it, expect, beforeEach } from 'vitest';
import ExcelJS from 'exceljs';
import { resetTestDb, testSql, asManager } from './setup';
import { ev } from './scheduleFixtures';
import { createDraftMonth } from '@/lib/monthPlan/months';
import { setPlanCell } from '@/lib/monthPlan/plan';
import { nameKey } from '@/lib/import/normalizeName';
import { readWorkbook } from '@/lib/import/workbook';
import { parseMonthSheet } from '@/lib/import/parseSheet';
import { buildMonthSheet } from '@/lib/export/monthSheet';
import { buildMonthWorkbook, writeMonthWorkbook } from '@/lib/export/writeWorkbook';
import { loadMonthSheet } from '@/lib/export/loadMonth';

// Без базы: одно мероприятие, АДМИН и ЗАЛ. Строки: 1 Даты, 2 День недели, 3 Время начала,
// 4 Время прихода, 5 Админ, 6 ЗАЛ, 7 Оплата, 8 Концерт, 9 Комментарии.
const model = buildMonthSheet({
  month: '2099-10',
  positions: [{ id: 'admin', name: 'АДМИН' }, { id: 'hall', name: 'ЗАЛ' }],
  events: [{
    date: '2099-10-01', startTime: '19:30', arriveTime: null, concert: 'Органный вечер', tag: 'organ',
    baseRate: 1500, comment: null, places: { admin: ['Алиса Выдумкина'] }, unplaced: [],
  }],
});
const thin = { style: 'thin', color: { argb: 'FF000000' } };
const solid = (argb: string) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });

describe('buildMonthWorkbook', () => {
  it('один лист месяца: ярлык, закреплена колонка A, ширины и высоты', () => {
    const wb = buildMonthWorkbook(model);
    expect(wb.worksheets.map((s) => s.name)).toEqual(['Октябрь 2099']);
    const ws = wb.worksheets[0];
    expect(ws.properties.tabColor).toEqual({ argb: 'FFFFA0CE' });
    expect(ws.properties.defaultRowHeight).toBe(15.75);
    expect(ws.properties.defaultColWidth).toBe(12.63);
    expect(ws.views[0]).toMatchObject({ state: 'frozen', xSplit: 1, ySplit: 0, topLeftCell: 'B1', zoomScale: 100 });
    expect(ws.getColumn(1).width).toBe(12.63);
    expect(ws.getColumn(2).width).toBe(12.25);
    expect([4, 5, 6, 7, 8, 9].map((r) => ws.getRow(r).height)).toEqual([18, 13.5, 16.5, 15.75, 34.5, 22.5]);
  });

  it('значения и стили клеток переносятся из описания', () => {
    const ws = buildMonthWorkbook(model).worksheets[0];
    const date = ws.getCell('B1');
    expect(date.value).toBe('1.10 (орган)');
    expect(date.numFmt).toBe('@');
    expect(date.font).toEqual({ name: 'Nunito', size: 9, bold: true, italic: false, color: { argb: 'FF000000' } });
    expect(date.fill).toEqual(solid('FFFCE5CD'));
    expect(date.alignment).toEqual({ horizontal: 'center', vertical: 'bottom', wrapText: false });
    expect(date.border).toEqual({ top: thin, left: thin, bottom: thin, right: thin });
    expect(ws.getCell('B3').value).toBe(0.8125);
    expect(ws.getCell('B3').numFmt).toBe('h:mm');
    expect(ws.getCell('B4').value).toBeNull();
    expect(ws.getCell('B5').value).toBe('Алиса Выдумкина');
    expect(ws.getCell('B6').value).toBeNull();
    expect(ws.getCell('B6').fill).toEqual(solid('FF000000'));
    expect(ws.getCell('B6').font).toMatchObject({ name: 'Lora', size: 10 });
    expect(ws.getCell('B7').value).toBe(1500);
    expect(ws.getCell('B7').fill).toEqual(solid('FFFFFFFF'));
    expect(ws.getCell('B8').alignment).toEqual({ vertical: 'middle', wrapText: true });
    expect(ws.getCell('B9').border).toEqual({ bottom: thin });
    expect(ws.getCell('A2').fill).toBeUndefined();
  });

  it('после записи и чтения: значения на месте, нет проверки данных и объединений', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await buildMonthWorkbook(model).xlsx.writeBuffer());
    expect(wb.worksheets).toHaveLength(1);
    const ws = wb.worksheets[0];
    expect(ws.name).toBe('Октябрь 2099');
    expect(ws.getCell('B1').value).toBe('1.10 (орган)');
    expect(ws.getCell('B3').value).toEqual(new Date(Date.UTC(1899, 11, 30, 19, 30)));
    expect(ws.getCell('B6').fill).toMatchObject({ fgColor: { argb: 'FF000000' } });
    expect(ws.views[0]).toMatchObject({ state: 'frozen', xSplit: 1 });
    ws.eachRow({ includeEmpty: true }, (row) => row.eachCell({ includeEmpty: true }, (cell) => {
      expect(cell.dataValidation).toBeUndefined();
      expect(cell.isMerged).toBe(false);
    }));
  });
});

describe('обратный ход без базы', () => {
  it('каждый тег мероприятия читается импортом обратно без замечаний', async () => {
    const tags = ['chapel', 'night', 'seder', 'organ', 'excursion', 'regular'] as const;
    const model = buildMonthSheet({
      month: '2099-10',
      positions: [{ id: 'admin', name: 'АДМИН' }, { id: 'hall', name: 'ЗАЛ' }],
      events: tags.map((tag, i) => ({
        date: `2099-10-0${i + 1}`, startTime: '19:00', arriveTime: '17:00', concert: `Вечер ${i + 1}`, tag,
        baseRate: null, comment: null, places: { admin: ['Алиса Выдумкина'] }, unplaced: [],
      })),
    });
    const [sheet] = await readWorkbook(await writeMonthWorkbook(model));
    const result = parseMonthSheet(sheet.rows, sheet.name);
    expect(result.issues).toEqual([]);
    expect(result.events.map((e) => [e.date, e.tag])).toEqual(tags.map((tag, i) => [`2099-10-0${i + 1}`, tag]));
    expect(result.events.every((e) => e.staff.length === 1 && e.staff[0].name === 'Алиса Выдумкина')).toBe(true);
  });
});

describe('выгрузка месяца из базы', () => {
  let first: string; let second: string;
  let pos: Record<string, string>;

  const worker = async (fullName: string): Promise<string> => {
    const [{ id }] = await testSql`
      insert into worker (full_name, name_key) values (${fullName}, ${nameKey(fullName)}) returning id`;
    return id;
  };
  const put = (eventId: string, positionId: string, row: number, workerId: string) =>
    asManager((tx) => setPlanCell(tx, { eventId, positionId, row, previousWorkerId: null, workerId }));

  // Черновик 2099-10 (черновик тоже выгружается), имена вымышленные.
  beforeEach(async () => {
    await resetTestDb();
    await asManager((tx) => createDraftMonth(tx, '2099-10', [
      ev('2099-10-03', '20:00', 'Лунная соната'),
      ev('2099-10-01', '19:30', 'Органный вечер', { tag: 'organ' }),
    ]));
    [{ id: first }, { id: second }] = await testSql`select id from event order by event_date`;
    pos = Object.fromEntries((await testSql`select id, name from position`).map((p) => [p.name, p.id]));
    await testSql`update event set arrive_time = null, base_rate = null where id = ${first}`;
    await testSql`update event set base_rate = 1300, comment = 'Вход со двора' where id = ${second}`;
    await put(first, pos['АДМИН'], 0, await worker('Алиса Выдумкина'));
    await put(first, pos['ЗАЛ'], 0, await worker('Вера Сказочная'));
    await put(first, pos['БИЛЕТЫ'], 2, await worker('Борис Небывалов'));
    const gleb = await worker('Глеб Придуманный');
    await testSql`insert into assignment (worker_id, event_id) values (${gleb}, ${second})`;
  });

  it('loadMonthSheet: все должности, места по строкам «Таблицы», комментарий, люди без должности', async () => {
    const input = await asManager((tx) => loadMonthSheet(tx, '2099-10'));
    expect(input.month).toBe('2099-10');
    expect(input.positions.map((p) => p.name)).toEqual(['АДМИН', 'ЗАЛ', 'ВХОД В ЗАЛ', 'БИЛЕТЫ', 'БАЛКОН', 'ВХОД', 'КАССА']);
    const [a, b] = input.events;
    expect([a.date, a.startTime, a.arriveTime, a.tag, a.baseRate, a.comment])
      .toEqual(['2099-10-01', '19:30', null, 'organ', null, null]);
    expect(a.places[pos['БИЛЕТЫ']]).toEqual([null, null, 'Борис Небывалов']);
    expect(a.places[pos['АДМИН']]).toEqual(['Алиса Выдумкина']);
    expect(a.unplaced).toEqual([]);
    expect([b.date, b.arriveTime, b.baseRate, b.comment, b.concert]).toEqual(['2099-10-03', '18:00', 1300, 'Вход со двора', 'Лунная соната']);
    expect(b.places[pos['БИЛЕТЫ']]).toEqual([null, null, null]);
    expect(b.unplaced).toEqual(['Глеб Придуманный']);
  });

  it('месяц без мероприятий — должности есть, мероприятий нет', async () => {
    const input = await asManager((tx) => loadMonthSheet(tx, '2099-11'));
    expect(input.events).toEqual([]);
    expect(input.positions).toHaveLength(7);
  });

  it('файл разбирается импортом (readWorkbook → parseMonthSheet) в те же мероприятия и людей, без замечаний', async () => {
    const input = await asManager((tx) => loadMonthSheet(tx, '2099-10'));
    const sheets = await readWorkbook(await writeMonthWorkbook(buildMonthSheet(input)));
    expect(sheets.map((s) => s.name)).toEqual(['Октябрь 2099']);
    const result = parseMonthSheet(sheets[0].rows, sheets[0].name);
    expect(result.issues).toEqual([]);
    expect(result.needsYear).toBe(false);
    expect(result.events).toEqual([
      {
        date: '2099-10-01', startTime: '19:30', arriveTime: null, concert: 'Органный вечер', tag: 'organ',
        baseRate: null, rawRate: null, comment: null,
        staff: [
          { name: 'Алиса Выдумкина', position: 'АДМИН' },
          { name: 'Вера Сказочная', position: 'ЗАЛ' },
          { name: 'Борис Небывалов', position: 'БИЛЕТЫ' },
        ],
      },
      {
        date: '2099-10-03', startTime: '20:00', arriveTime: '18:00', concert: 'Лунная соната', tag: 'regular',
        baseRate: 1300, rawRate: null, comment: 'Вход со двора',
        staff: [{ name: 'Глеб Придуманный', position: null }],
      },
    ]);
  });

  it('пустой месяц: лист только с подписями, импорт не находит мероприятий и замечаний', async () => {
    const input = await asManager((tx) => loadMonthSheet(tx, '2099-11'));
    const [sheet] = await readWorkbook(await writeMonthWorkbook(buildMonthSheet(input)));
    expect(sheet.name).toBe('Ноябрь 2099');
    expect(sheet.rows.every((row) => row.length === 1)).toBe(true);
    expect(parseMonthSheet(sheet.rows, sheet.name)).toEqual({ events: [], issues: [], needsYear: false });
  });
});
