import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { UserError } from '@/lib/errors';
import type { SheetCell, SheetRows } from './parseSheet';

export type WorkbookSheet = { name: string; rows: SheetRows };

/**
 * Общий лимит размера загружаемого файла для /api/import/preview и /api/import/apply.
 * Vercel режет тело запроса к функции на 4,5 МБ — лимит ниже, с запасом на
 * multipart-обёртку, чтобы пользователь увидел понятный текст, а не 413.
 */
export const MAX_IMPORT_FILE_BYTES = 4 * 1024 * 1024;
export const TOO_LARGE_MESSAGE = 'Файл больше 4 МБ';

/**
 * Пределы разбора (L2 полного ревью безопасности): 4 МБ сжатого xlsx могут распаковаться в гигабайты
 * (zip-бомба), а одна ячейка в XFD1048576 заставила бы обходить миллион пустых строк. Настоящая таблица
 * Анненкирхе — 2 МБ распакованных, 182 части, 54 листа, до ~1000 строк и ~80 колонок: пределы — с запасом.
 */
export const MAX_UNPACKED_BYTES = 30 * 1024 * 1024;
export const MAX_ZIP_ENTRIES = 2000;
export const MAX_SHEETS = 200;
export const MAX_SHEET_ROWS = 5000;
export const MAX_SHEET_COLUMNS = 500;

const UNPACKED_MESSAGE = 'Файл слишком большой в распакованном виде (больше 30 МБ) — это не похоже на таблицу смен. '
  + 'Сохраните в Excel только нужные листы и загрузите снова.';
const ENTRIES_MESSAGE = `В файле слишком много частей (больше ${MAX_ZIP_ENTRIES}) — это не похоже на обычную таблицу Excel.`;

/** Сколько байт даёт часть архива при распаковке — потоком, с остановкой на пределе: заголовкам zip не верим. */
function unpackedSize(file: JSZip.JSZipObject, budget: number): Promise<number> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const stream = file.nodeStream('nodebuffer');
    stream.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > budget) {
        stream.pause();
        stream.removeAllListeners();
        reject(new UserError(UNPACKED_MESSAGE));
      }
    });
    stream.on('error', reject);
    stream.on('end', () => resolve(size));
  });
}

/** До exceljs: число частей и настоящий распакованный объём (каждая часть распаковывается и сразу выбрасывается). */
async function checkArchive(data: Buffer): Promise<void> {
  const zip = await JSZip.loadAsync(data);
  const files = Object.values(zip.files).filter((f) => !f.dir);
  if (files.length > MAX_ZIP_ENTRIES) throw new UserError(ENTRIES_MESSAGE);
  let total = 0;
  for (const file of files) total += await unpackedSize(file, MAX_UNPACKED_BYTES - total);
}

/** После загрузки, до обхода строк: листов не больше MAX_SHEETS, у листа — не больше MAX_SHEET_ROWS × MAX_SHEET_COLUMNS. */
function checkSheets(wb: ExcelJS.Workbook): void {
  if (wb.worksheets.length > MAX_SHEETS) {
    throw new UserError(`В файле слишком много листов: ${wb.worksheets.length} (можно до ${MAX_SHEETS}). Оставьте нужные листы и загрузите снова.`);
  }
  for (const ws of wb.worksheets) {
    if (ws.rowCount > MAX_SHEET_ROWS) {
      throw new UserError(`Лист «${ws.name}» слишком большой: ${ws.rowCount} строк (можно до ${MAX_SHEET_ROWS}). `
        + 'Удалите пустые строки внизу листа и загрузите снова.');
    }
    if (ws.columnCount > MAX_SHEET_COLUMNS) {
      throw new UserError(`Лист «${ws.name}» слишком широкий: ${ws.columnCount} колонок (можно до ${MAX_SHEET_COLUMNS}). `
        + 'Удалите пустые колонки справа и загрузите снова.');
    }
  }
}

/** Граница с exceljs: единственное место, где значение ячейки не типизировано. */
export function cellValue(value: unknown): SheetCell {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number') return value;
  if (value instanceof Date) return value;
  // TRUE/FALSE не бывают осмысленной ячейкой листа месяца (имя, дата, ставка…):
  // строкой 'true'/'false' они превратились бы, например, в «сотрудника».
  if (typeof value === 'boolean') return null;
  if (typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if ('result' in v) return cellValue(v.result);
    if (Array.isArray(v.richText)) {
      return v.richText
        .map((part) => (typeof part === 'object' && part && 'text' in part ? String((part as Record<string, unknown>).text) : ''))
        .join('');
    }
    if (typeof v.text === 'string') return v.text;
  }
  return null;
}

export async function readWorkbook(data: Buffer): Promise<WorkbookSheet[]> {
  await checkArchive(data);
  const wb = new ExcelJS.Workbook();
  // exceljs объявляет собственный локальный тип `Buffer extends ArrayBuffer`
  // (см. node_modules/exceljs/index.d.ts), который не совпадает со структурой
  // Node.js Buffer в текущих @types/node (там ArrayBuffer требует
  // maxByteLength/resizable/…). На рантайме exceljs проверяет через
  // Buffer.isBuffer и работает с обычным Node Buffer корректно — расхождение
  // только в типах. Проводим через unknown, это единственное место с unknown.
  await wb.xlsx.load(data as unknown as Parameters<typeof wb.xlsx.load>[0]);
  checkSheets(wb);

  const sheets: WorkbookSheet[] = [];
  wb.eachSheet((ws) => {
    const rows: SheetRows = [];
    ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      const values = Array.isArray(row.values) ? row.values.slice(1) : [];
      rows[rowNumber - 1] = Array.from(values, cellValue);
    });
    for (let i = 0; i < rows.length; i++) rows[i] ??= [];
    sheets.push({ name: ws.name, rows });
  });
  return sheets;
}
