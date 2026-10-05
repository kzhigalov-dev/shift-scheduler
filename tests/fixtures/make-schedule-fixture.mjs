// Генератор tests/fixtures/schedule.xlsx — вымышленное расписание в формате
// «Расписание мероприятий.xlsx» (листы с января 2026). Реальных контактов,
// исполнителей и комментариев здесь нет.
// Запуск: node tests/fixtures/make-schedule-fixture.mjs
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';

// jszip — зависимость exceljs; берём ту же копию, что и он.
const JSZip = createRequire(createRequire(import.meta.url).resolve('exceljs'))('jszip');

const HEAD1 = { 8: 'ЗАКРЫТИЕ', 9: 'ЗАКРЫТИЕ', 12: 'ДИЗАЙН ', 13: 'ДИЗАЙН ', 14: 'ДИЗАЙН ' };
const HEAD2 = ['дата', '', 'направление', 'площадка', 'организатор', 'название', 'начало',
  'БЗ', 'кирха', 'Запуск', 'идет', 'исполнители', 'готовность афиши', 'комментарий '];
const t = (hh, mm) => new Date(Date.UTC(1899, 11, 30, hh, mm));

// [день, день недели, направление, площадка, организатор, название, начало, запуск, идет, исполнители, комментарий]
const ROWS = [
  [1, 'ср', 'приход', 'АННЕНКИРХЕ', 'приход', 'Богослужение в БЗ', t(19, 0), t(18, 30), '1час 15 мин', '', ''],
  [1, 'ср', 'концерт', 'АННЕНКИРХЕ', 'арт-зерно', 'Концерт в часовне', t(20, 30), t(20, 0), '1 час\nкафе до 22:00', '', ''],
  [1, 'ср', 'концерт', 'АННЕНКИРХЕ', 'аккорд', 'Вивальди. Времена года', t(22, 30), t(22, 0), '1 час 15 мин', '', ''],
  [3, 'пт', 'концерт', 'АННЕНКИРХЕ', 'арт-зерно2', 'Лунный свет\nНочной орган в Анненкирхе', '20:00\n22:30',
    '19:15\n22:00', '1 ч 15 мин\nкафе до 22:30', 'Иван Тестов (орган)', 'Вымышленный комментарий'],
  [4, 'сб', 'концерт', 'ПУШКИН', 'арт-зерно', 'Резонанс эпох', t(18, 0), t(17, 30), '1 ч', '', ''],
  [6, 'пн', 'репетиция', 'АННЕНКИРХЕ', 'арт-зерно', 'репа в бз орган', t(10, 0), t(13, 0), '', '', ''],
  [6, 'пн', 'ужин', 'АННЕНКИРХЕ', 'арт-зерно', 'Тайная вечеря ', t(20, 0), t(19, 30), '2 часа ', '', ''],
  [7, 'вт', 'концерт', 'АННЕНКИРХЕ', 'Арт-Зерно', ' органный вторник под луной', t(20, 0), t(19, 15), '1 час ', '', ''],
  [8, 'ср', 'экскурсия', 'АННЕНКИРХЕ', 'арт-зерно', 'Ночная экскурсия по церкви', t(21, 0), '', '', '', ''],
  [9, 'чт', 'концерт', 'АННЕНКИРХЕ', 'арт-зерно', 'Музыка из кино', 'уточняется', '', '', '', ''],
  [10, 'пт', 'концерт', '', 'арт-зерно', 'Без площадки', t(20, 0), '', '', '', ''],
];

function scheduleSheet(wb, name, year, month) {
  const ws = wb.addWorksheet(name);
  for (const [col, value] of Object.entries(HEAD1)) ws.getRow(1).getCell(Number(col)).value = value;
  HEAD2.forEach((value, i) => { ws.getRow(2).getCell(i + 1).value = value || null; });
  const put = (rowNumber, cells) => {
    const row = ws.getRow(rowNumber);
    cells.forEach((value, i) => {
      if (value === '' || value === null) return;
      const cell = row.getCell(i + 1);
      cell.value = value;
      if (value instanceof Date) cell.numFmt = i === 0 ? 'dd.mm.yyyy' : 'hh:mm';
    });
  };
  let r = 3;
  for (const [day, weekday, direction, venue, organizer, title, start, launch, goes, performers, comment] of ROWS) {
    put(r++, [new Date(Date.UTC(year, month - 1, day)), weekday, direction, venue, organizer, title, start,
      '', '', launch, goes, performers, '', comment]);
  }
  // Заранее проставленная дата без площадки, названия и начала — пропускается молча.
  put(r++, [new Date(Date.UTC(year, month - 1, 11)), 'сб']);
  // Дата из следующего месяца — проблемная строка.
  put(r++, [new Date(Date.UTC(year, month, 1)), 'сб', 'концерт', 'АННЕНКИРХЕ', 'арт-зерно', 'Чужой месяц', t(20, 0)]);
  // Пустые строки с одним днём недели — пропускаются молча.
  put(r++, ['', 'вс']);
  put(r++, ['', 'пн']);
}

const wb = new ExcelJS.Workbook();
scheduleSheet(wb, 'июль 26', 2026, 7);
scheduleSheet(wb, 'ноя 98', 2098, 11);
scheduleSheet(wb, 'дек 98', 2098, 12);
// Лист заведён заранее: у дней стоят даты, мероприятие только на другой площадке — Анненкирхе пусто.
const empty = wb.addWorksheet('янв 99');
HEAD2.forEach((value, i) => { empty.getRow(2).getCell(i + 1).value = value || null; });
[[1, 'чт'], [2, 'пт'], [3, 'сб'], [4, 'вс', 'концерт', 'ПУШКИН', 'арт-зерно', 'Резонанс эпох', t(18, 0)], [5, 'пн']]
  .forEach(([day, ...rest], i) => {
    const row = empty.getRow(3 + i);
    [new Date(Date.UTC(2099, 0, day)), ...rest].forEach((value, col) => {
      const cell = row.getCell(col + 1);
      cell.value = value;
      if (value instanceof Date) cell.numFmt = col === 0 ? 'dd.mm.yyyy' : 'hh:mm';
    });
  });
const old = wb.addWorksheet('июль 25');
old.getRow(2).values = ['дата', '', 'организатор', 'Что, где, кто', 'начало'];
old.getRow(3).values = [new Date(Date.UTC(2025, 6, 1)), 'вт', 'арт-зерно', 'Старый формат', t(20, 0)];
const other = wb.addWorksheet('ПУШКИН');
other.getRow(1).values = ['КОНЦЕРТЫ В ПУШКИНЕ И РЕПЕТИЦИИ'];
// Постоянные даты книги и записей архива — файл пересобирается байт в байт.
const FIXED = new Date(Date.UTC(2026, 0, 1));
wb.created = FIXED;
wb.modified = FIXED;
const zip = await JSZip.loadAsync(await wb.xlsx.writeBuffer());
for (const entry of Object.values(zip.files)) entry.date = FIXED;
await writeFile(new URL('./schedule.xlsx', import.meta.url),
  await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
