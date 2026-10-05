import { describe, it, expect, vi, afterEach } from 'vitest';
import postgres from 'postgres';
import { readFileSync } from 'node:fs';
import {
  previewSheets, parseSelection, eventsForSelection, importErrorResponse, scheduleMonthsInstead,
} from '@/lib/import/prepare';
import { readWorkbook } from '@/lib/import/workbook';
import { UserError } from '@/lib/errors';
import type { WorkbookSheet } from '@/lib/import/workbook';
import type { SheetRows } from '@/lib/import/parseSheet';

const month: SheetRows = [
  ['Даты', '9.7'],
  ['День недели', 'четверг'],
  ['Время начала', '20:00'],
  ['Админ', 'Ян Образцовый'],
  ['Оплата', 1300],
];

const sheets: WorkbookSheet[] = [
  { name: 'Июль 2026', rows: month },
  { name: 'Июль', rows: month },
  { name: 'Работники', rows: [['ФИО'], ['Полина Фиктивная']] },
];

describe('previewSheets', () => {
  it('показывает листы месяцев и скрывает остальные', () => {
    expect(previewSheets(sheets).map((p) => p.sheetName)).toEqual(['Июль 2026', 'Июль']);
  });

  it('помечает лист без года и даёт краткую сводку событий', () => {
    const [withYear, withoutYear] = previewSheets(sheets);
    expect(withYear.events).toEqual([
      { date: '2026-07-09', startTime: '20:00', concert: null, staffCount: 1 },
    ]);
    expect(withoutYear.needsYear).toBe(true);
  });
});

describe('parseSelection', () => {
  it('принимает имена и годы', () => {
    expect(parseSelection([{ name: 'Июль 2026' }, { name: 'Июль', year: 2023 }]))
      .toEqual([{ name: 'Июль 2026' }, { name: 'Июль', year: 2023 }]);
  });

  it('отвергает мусор', () => {
    expect(() => parseSelection('Июль')).toThrow();
    expect(() => parseSelection([{ name: 1 }])).toThrow();
    expect(() => parseSelection([{ name: 'Июль', year: 1999 }])).toThrow(/год/);
    expect(() => parseSelection([{ name: 'Июль', year: 2023.5 }])).toThrow(/год/);
  });
});

describe('eventsForSelection', () => {
  it('разбирает выбранные листы с выбранным годом', () => {
    const events = eventsForSelection(sheets, [{ name: 'Июль', year: 2023 }]);
    expect(events.map((e) => e.date)).toEqual(['2023-07-09']);
  });

  it('не пропускает лист без года', () => {
    expect(() => eventsForSelection(sheets, [{ name: 'Июль' }])).toThrow(/год/);
  });

  it('не пропускает несуществующий лист и пустой выбор', () => {
    expect(() => eventsForSelection(sheets, [{ name: 'Август' }])).toThrow(/Август/);
    expect(() => eventsForSelection(sheets, [])).toThrow();
  });
});

/**
 * Тестовый конструктор `PostgresError` в @types/postgres принимает только
 * `string` (сигнатура унаследована от `Error`), а на рантайме библиотека
 * создаёт его из объекта `{ message, code, ... }` (см. node_modules/postgres/src/errors.js)
 * — расхождение чисто в типах, как и `exceljs`/`Buffer` в workbook.ts.
 * Строим экземпляр напрямую подменой прототипа, без вызова конструктора
 * библиотеки, чтобы `instanceof postgres.PostgresError` было истинным.
 */
function fakePostgresError(message: string, code: string): unknown {
  const error = Object.assign(new Error(message), { code });
  Object.setPrototypeOf(error, postgres.PostgresError.prototype);
  return error;
}

describe('importErrorResponse', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('наша ошибка (UserError) — 400 с текстом ошибки', () => {
    expect(importErrorResponse(new UserError('Не выбран ни один лист'))).toEqual({
      status: 400,
      body: { error: 'Не выбран ни один лист' },
    });
  });

  it('обычная ошибка (не UserError) — 500, текст не утекает, залогирована', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(importErrorResponse(new Error('relation "event" does not exist'))).toEqual({
      status: 500,
      body: { error: 'Ошибка базы при импорте — ничего не записано' },
    });
    expect(spy).toHaveBeenCalled();
  });

  it('ошибка Postgres — 500 без текста SQL, залогирована на сервере', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const pgError = fakePostgresError('invalid input syntax for type date: "не-дата"', '22007');
    expect(pgError instanceof postgres.PostgresError).toBe(true);
    expect(importErrorResponse(pgError)).toEqual({
      status: 500,
      body: { error: 'Ошибка базы при импорте — ничего не записано' },
    });
    expect(spy).toHaveBeenCalled();
  });

  it('не Error вовсе — 500', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(importErrorResponse('что-то странное')).toEqual({
      status: 500,
      body: { error: 'Ошибка базы при импорте — ничего не записано' },
    });
  });
});

describe('scheduleMonthsInstead', () => {
  it('расписание мероприятий (без людей) — месяцы расписания, а не «нет строки День недели»', async () => {
    const sheets = await readWorkbook(readFileSync('tests/fixtures/schedule.xlsx'));
    expect(previewSheets(sheets).every((s) => s.events.length === 0)).toBe(true);
    const months = scheduleMonthsInstead(sheets);
    expect(months.length).toBeGreaterThan(0);
    expect(months.every((m) => /^\d{4}-\d{2}$/.test(m))).toBe(true);
    expect([...months].sort()).toEqual(months);
  });

  it('таблица работников с мероприятиями — не расписание', () => {
    expect(scheduleMonthsInstead([{ name: 'Июль 2026', rows: month }])).toEqual([]);
  });
});
