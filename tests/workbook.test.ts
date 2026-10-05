import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import {
  cellValue, readWorkbook, MAX_IMPORT_FILE_BYTES, TOO_LARGE_MESSAGE,
  MAX_UNPACKED_BYTES, MAX_ZIP_ENTRIES, MAX_SHEETS, MAX_SHEET_ROWS, MAX_SHEET_COLUMNS,
} from '@/lib/import/workbook';
import { UserError } from '@/lib/errors';

describe('лимит размера файла импорта', () => {
  it('4 МБ — ниже лимита тела запроса Vercel (4,5 МБ) с запасом на multipart', () => {
    expect(MAX_IMPORT_FILE_BYTES).toBe(4 * 1024 * 1024);
    expect(MAX_IMPORT_FILE_BYTES).toBeLessThan(4.5 * 1000 * 1000);
    expect(TOO_LARGE_MESSAGE).toBe('Файл больше 4 МБ');
  });
});

describe('cellValue', () => {
  it('раскрывает формулы, rich text и ссылки', () => {
    expect(cellValue({ formula: 'A1*2', result: 2600 })).toBe(2600);
    expect(cellValue({ richText: [{ text: 'Лунный ' }, { text: 'свет' }] })).toBe('Лунный свет');
    expect(cellValue({ text: 'сайт', hyperlink: 'https://example.com' })).toBe('сайт');
  });

  it('ошибки и пустоту превращает в null', () => {
    expect(cellValue({ error: '#REF!' })).toBeNull();
    expect(cellValue(undefined)).toBeNull();
  });

  it('булево значение превращает в null, а не в текст «true»/«false»', () => {
    expect(cellValue(true)).toBeNull();
    expect(cellValue(false)).toBeNull();
  });

  it('строки, числа и даты оставляет как есть', () => {
    const d = new Date(Date.UTC(2026, 6, 9));
    expect([cellValue('a'), cellValue(1.5), cellValue(d)]).toEqual(['a', 1.5, d]);
  });
});

describe('readWorkbook', () => {
  it('возвращает листы построчно, первая колонка — индекс 0', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Июль 2026');
    ws.getCell('A1').value = 'Даты';
    ws.getCell('C1').value = '9.7';
    ws.getCell('A3').value = { formula: '1+1', result: 2 };
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());

    const [sheet] = await readWorkbook(buffer);
    expect(sheet.name).toBe('Июль 2026');
    expect(sheet.rows[0]).toEqual(['Даты', null, '9.7']);
    expect(sheet.rows[1]).toEqual([]);
    expect(sheet.rows[2]).toEqual([2]);
  });
});

/** Книга exceljs с одним листом; `fill` — ячейки. */
async function book(fill: (ws: ExcelJS.Worksheet) => void, sheets = 1): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (let i = 0; i < sheets; i++) {
    const ws = wb.addWorksheet(`Лист ${i + 1}`);
    if (i === 0) fill(ws);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Добавить в готовую книгу файлы (zip-бомба, мусор) — как их положил бы автор вредного файла. */
async function withExtra(buffer: Buffer, extra: (zip: JSZip) => void): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer);
  extra(zip);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

describe('readWorkbook: пределы до и во время разбора (L2)', () => {
  it('пределы выше настоящего файла (2 МБ распакованных, 182 части, 54 листа, до 1021 строки и 76 колонок)', () => {
    expect(MAX_UNPACKED_BYTES).toBeGreaterThanOrEqual(20 * 1024 * 1024);
    expect(MAX_ZIP_ENTRIES).toBeGreaterThan(182 * 2);
    expect(MAX_SHEETS).toBeGreaterThan(54 * 2);
    expect(MAX_SHEET_ROWS).toBeGreaterThan(1021 * 2);
    expect(MAX_SHEET_COLUMNS).toBeGreaterThan(76 * 2);
  });

  it('zip-бомба: распакованное больше предела — понятный отказ, без разбора exceljs', async () => {
    const bomb = await withExtra(await book(() => {}), (zip) => {
      zip.file('xl/media/bomb.bin', Buffer.alloc(MAX_UNPACKED_BYTES + 1024 * 1024));
    });
    expect(bomb.length).toBeLessThan(MAX_IMPORT_FILE_BYTES);
    const error = await readWorkbook(bomb).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UserError);
    expect((error as Error).message).toMatch(/распакованн/);
  });

  it('слишком много частей в архиве — отказ', async () => {
    const many = await withExtra(await book(() => {}), (zip) => {
      for (let i = 0; i <= MAX_ZIP_ENTRIES; i++) zip.file(`x/${i}.txt`, '');
    });
    await expect(readWorkbook(many)).rejects.toThrow(/частей/);
  });

  it('слишком много листов — отказ', async () => {
    await expect(readWorkbook(await book(() => {}, MAX_SHEETS + 1))).rejects.toThrow(new RegExp(`листов.*${MAX_SHEETS}`));
  });

  it('ячейка далеко внизу (разреженный лист) — отказ с именем листа, без обхода миллиона строк', async () => {
    const sparse = await book((ws) => { ws.getCell(`A${MAX_SHEET_ROWS + 1}`).value = 'x'; });
    await expect(readWorkbook(sparse)).rejects.toThrow(/«Лист 1».*строк/);
    const far = await book((ws) => { ws.getCell('A1048576').value = 'x'; });
    await expect(readWorkbook(far)).rejects.toThrow(UserError);
  });

  it('ячейка далеко справа — отказ', async () => {
    const wide = await book((ws) => { ws.getCell(1, MAX_SHEET_COLUMNS + 1).value = 'x'; });
    await expect(readWorkbook(wide)).rejects.toThrow(/«Лист 1».*колон/);
  });

  it('на границе пределов — читается', async () => {
    const edge = await book((ws) => {
      ws.getCell(MAX_SHEET_ROWS, 1).value = 'низ';
      ws.getCell(1, MAX_SHEET_COLUMNS).value = 'право';
    });
    const [sheet] = await readWorkbook(edge);
    expect(sheet.rows).toHaveLength(MAX_SHEET_ROWS);
  });
});
