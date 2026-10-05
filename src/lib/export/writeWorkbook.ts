import ExcelJS from 'exceljs';
import { SHEET_FORMAT, type CellStyle, type MonthSheetModel } from './monthSheet';

const THIN: Partial<ExcelJS.Border> = { style: 'thin', color: { argb: SHEET_FORMAT.borderColor } };

function applyStyle(cell: ExcelJS.Cell, s: CellStyle): void {
  cell.font = {
    name: s.font.name, size: s.font.size, bold: s.font.bold === true, italic: s.font.italic === true,
    color: { argb: SHEET_FORMAT.fontColor },
  };
  if (s.fill !== null) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: s.fill } };
  cell.border = s.border === 'all' ? { top: THIN, left: THIN, bottom: THIN, right: THIN } : { bottom: THIN };
  cell.alignment = { ...(s.horizontal ? { horizontal: s.horizontal } : {}), vertical: s.vertical, wrapText: s.wrap };
  if (s.numFmt !== null) cell.numFmt = s.numFmt;
}

/**
 * Описание листа → книга exceljs: один лист, закреплена колонка A. Проверки данных,
 * объединений, условного форматирования и настроек печати нет — как и в описании.
 */
export function buildMonthWorkbook(model: MonthSheetModel): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(model.name, {
    properties: {
      tabColor: { argb: SHEET_FORMAT.tabColor },
      defaultRowHeight: SHEET_FORMAT.defaultRowHeight,
      defaultColWidth: SHEET_FORMAT.defaultColWidth,
    },
    views: [{ state: 'frozen', xSplit: 1, ySplit: 0, topLeftCell: 'B1', zoomScale: 100 }],
  });

  const columns = Math.max(1, ...model.rows.map((r) => r.cells.length));
  ws.getColumn(1).width = SHEET_FORMAT.labelColWidth;
  for (let c = 2; c <= columns; c++) ws.getColumn(c).width = SHEET_FORMAT.eventColWidth;

  model.rows.forEach((row, i) => {
    const target = ws.getRow(i + 1);
    if (row.height !== null) target.height = row.height;
    row.cells.forEach((cell, j) => {
      const c = target.getCell(j + 1);
      c.value = cell.value;
      applyStyle(c, cell.style);
    });
  });
  return wb;
}

/**
 * Книга в байты. writeBuffer() в типах exceljs — локальный тип «Buffer extends ArrayBuffer»;
 * Buffer.from приводит его к настоящему Node Buffer (его же принимает readWorkbook).
 */
export async function writeMonthWorkbook(model: MonthSheetModel): Promise<Buffer> {
  return Buffer.from(await buildMonthWorkbook(model).xlsx.writeBuffer());
}
