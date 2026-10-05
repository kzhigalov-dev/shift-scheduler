/** Все значения вымышлены. Рабочие Excel-файлы не нужны для тестов. */
import ExcelJS from 'exceljs';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

await mkdir(new URL('../tests/fixtures/', import.meta.url), { recursive: true });
async function save(name, sheets) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Demo fixtures';
  wb.created = wb.modified = new Date('2026-01-01T00:00:00Z');
  for (const [name, rows] of sheets) {
    const ws = wb.addWorksheet(name);
    for (const row of rows) ws.addRow(row);
  }
  await wb.xlsx.writeFile(fileURLToPath(new URL(`../tests/fixtures/${name}.xlsx`, import.meta.url)));
}
const dates = Array.from({ length: 34 }, (_, i) => `${Math.min(i + 1, 31)}.7`);
const times = dates.map((_, i) => i < 31 ? '20:00' : '22:30');
const rows = [
  ['Даты', ...dates], ['День недели', ...dates.map(() => 'среда')],
  ['Время начала', ...times], ['Время прихода', ...dates.map(() => '18:00')],
  ['АДМИН', ...dates.map(() => 'Ян Образцовый')],
  ['РАБОТНИК', ...dates.map(() => 'Семён Шаблонов')],
  ['КАССА', ...dates.map(() => 'Полина Фиктивная')],
  ['Оплата', ...dates.map(() => 1500)],
  ['Концерт', ...dates.map((_, i) => `Концерт № ${i + 1}`)],
];
const positions = rows.map(row => [row[0] === 'РАБОТНИК' ? 'ЗАЛ' : row[0], ...row.slice(1)]);
await save('demo-staff', [['Июль 2026', rows], ['Июль 2026 (позиции)', positions]]);
await save('google-staff', [['Декабрь 2098', [
  ['Даты', '3.12'], ['День недели', 'среда'], ['Время начала', '20:00'],
  ['БИЛЕТЫ', 'Тестовый работник'], ['Концерт', 'Лунный свет'],
]]]);
await save('concerts', [['Декабрь 2098', [
  ['Дата', 'Название', 'Время', 'Описание', 'Артисты'],
  ['03.12.2098', 'Вечер музыки при свечах: путешествие от барокко к современности', '19:00',
    'Иоганн Себастьян Бах — Токката и фуга ре минор.\nКамерный ансамбль — сюита в четырёх частях.\n'.repeat(5),
    'Камерный ансамбль «Музыкальные истории»: орган, скрипка, виолончель, сопрано и баритон.'],
  ['04.12.2098', 'Концерт без совпадения', '20:00', 'Программа концерта', 'Тестовый ансамбль'],
]]]);
await import('../tests/fixtures/make-schedule-fixture.mjs');
console.log('Созданы демонстрационные таблицы.');
