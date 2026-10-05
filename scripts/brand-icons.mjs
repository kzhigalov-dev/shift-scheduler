// Иконки приложения из знака BrandMark (src/lib/brand.ts): вкладка, apple-icon, манифест, favicon.ico.
// Запуск: node scripts/brand-icons.mjs (нужен Chromium Playwright). Результат коммитится;
// перезапускать только после изменения знака или цветов марки.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { BRAND_COLORS, BRAND_MARK_PATH } from '../src/lib/brand.ts';

const { primary, primaryDark, background } = BRAND_COLORS;

// Вкладка: знак без подложки, цвет по теме браузера.
const tabIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">`
  + `<style>path{fill:${primary}}@media (prefers-color-scheme:dark){path{fill:${primaryDark}}}</style>`
  + `<path d="${BRAND_MARK_PATH}"/></svg>\n`;
writeFileSync('src/app/icon.svg', tabIcon);

/** Знак светлым на терракотовой плитке. `mark` — доля высоты плитки под знак, `radius` — доля скругления. */
function tile(size, { mark, radius }) {
  const s = (size * mark) / 32;
  const tx = size / 2 - 16 * s;
  const ty = (size - 32 * s) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`
    + `<rect width="${size}" height="${size}" rx="${size * radius}" fill="${primary}"/>`
    + `<path transform="translate(${tx} ${ty}) scale(${s})" fill="${background}" d="${BRAND_MARK_PATH}"/></svg>`;
}

const browser = await chromium.launch();
async function png(svg, size) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<body style="margin:0;background:transparent">${svg}</body>`);
  const buf = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  await page.close();
  return buf;
}

// iOS скругляет сам: плитка без скругления, знак — 60 % высоты.
writeFileSync('src/app/apple-icon.png', await png(tile(180, { mark: 0.6, radius: 0 }), 180));
// Манифест: скруглённая плитка, знак внутри безопасной зоны.
for (const size of [192, 512]) {
  writeFileSync(`public/icon-${size}.png`, await png(tile(size, { mark: 0.6, radius: 0.2 }), size));
}
// favicon.ico для старых браузеров: плитка читается на любой панели вкладок; знак крупнее.
const icoSizes = [16, 32, 48];
const images = [];
for (const size of icoSizes) images.push(await png(tile(size, { mark: 0.84, radius: 0.18 }), size));
await browser.close();

// ICO с PNG внутри: заголовок 6 байт, по 16 байт на картинку, затем сами PNG.
const header = Buffer.alloc(6 + 16 * images.length);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);
let offset = header.length;
images.forEach((img, i) => {
  const e = 6 + 16 * i;
  header.writeUInt8(icoSizes[i], e);
  header.writeUInt8(icoSizes[i], e + 1);
  header.writeUInt16LE(1, e + 4);
  header.writeUInt16LE(32, e + 6);
  header.writeUInt32LE(img.length, e + 8);
  header.writeUInt32LE(offset, e + 12);
  offset += img.length;
});
writeFileSync('src/app/favicon.ico', Buffer.concat([header, ...images]));
console.log('иконки обновлены: icon.svg, apple-icon.png, icon-192.png, icon-512.png, favicon.ico');
