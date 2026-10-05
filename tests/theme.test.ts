import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { BRAND_COLORS, BRAND_MARK_PATH } from '@/lib/brand';
import manifest from '@/app/manifest';

const css = readFileSync(path.resolve(__dirname, '../src/app/globals.css'), 'utf8');

/** Переменные вида `--name: #rrggbb;` из блока, начинающегося с `marker`. */
function block(marker: string): Record<string, string> {
  const start = css.indexOf(marker);
  if (start < 0) throw new Error(`нет блока ${marker}`);
  const open = css.indexOf('{', css.indexOf(':root', start));
  const close = css.indexOf('}', open);
  const vars: Record<string, string> = {};
  for (const m of css.slice(open, close).matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    vars[m[1]] = m[2];
  }
  return vars;
}

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** Смешанный цвет: `top` с непрозрачностью `alpha` поверх `under` (как рисует браузер). */
function blend(top: string, under: string, alpha: number): string {
  const ch = (hex: string, i: number) => parseInt(hex.slice(i, i + 2), 16);
  return `#${[1, 3, 5].map((i) => Math.round(ch(top, i) * alpha + ch(under, i) * (1 - alpha))
    .toString(16).padStart(2, '0')).join('')}`;
}

// [текст, фон] — все пары, которые реально встречаются в интерфейсе.
const PAIRS: [string, string][] = [
  ['foreground', 'background'], ['foreground', 'card'], ['foreground', 'sidebar'],
  ['foreground', 'muted'], ['foreground', 'popover'], ['foreground', 'sidebar-accent'],
  ['muted-foreground', 'background'], ['muted-foreground', 'card'], ['muted-foreground', 'sidebar'],
  ['muted-foreground', 'muted'], ['muted-foreground', 'sidebar-accent'],
  ['primary-foreground', 'primary'], ['primary', 'background'],
  ['destructive', 'background'], ['destructive', 'card'], ['destructive', 'popover'],
  // Кнопка variant="destructive": сплошная заливка, без прозрачности — подложка диалога
  // (popover, подвал bg-muted/50) на цвет не влияет; смешивание проверено ниже.
  ['destructive-foreground', 'destructive'],
  // Все пары «*-foreground на своём фоне» shadcn и бокового меню.
  ['card-foreground', 'card'], ['popover-foreground', 'popover'],
  ['secondary-foreground', 'secondary'], ['accent-foreground', 'accent'], ['muted-foreground', 'accent'],
  ['sidebar-foreground', 'sidebar'], ['sidebar-foreground', 'sidebar-accent'],
  ['sidebar-accent-foreground', 'sidebar-accent'], ['sidebar-primary-foreground', 'sidebar-primary'],
  // Терракотовый текст (ссылки, акценты) на карточке и в боковом меню.
  ['primary', 'card'], ['primary', 'sidebar'],
  ['status-success-fg', 'status-success-bg'], ['status-danger-fg', 'status-danger-bg'],
  ['status-warning-fg', 'status-warning-bg'], ['status-neutral-fg', 'status-neutral-bg'],
];

// [элемент, фон] — не текст: знак, значок активного пункта меню, рамка фокуса.
const UI_PAIRS: [string, string][] = [
  ['sidebar-primary', 'sidebar'], ['sidebar-primary', 'sidebar-accent'],
  ['primary', 'background'], ['ring', 'background'], ['ring', 'card'],
];

describe.each([
  ['светлая', ':root {'],
  ['тёмная', '@media (prefers-color-scheme: dark)'],
])('тема %s', (_name, marker) => {
  const vars = block(marker);

  // Подвал диалога: bg-muted/50 поверх --popover (dialog.tsx). Здесь стоят кнопки диалогов
  // («Удалить», «Снять», «В архив», «Отправить запрос») и текст ошибок.
  const footer = () => blend(vars.muted, vars.popover, 0.5);

  it('текст destructive-кнопки на её фоне (заливка непрозрачная) — не ниже 4.5', () => {
    expect(contrast(vars['destructive-foreground'], vars.destructive)).toBeGreaterThanOrEqual(4.5);
  });

  it('destructive-текст на подвале диалога (muted/50 поверх popover) — не ниже 4.5', () => {
    expect(contrast(vars.destructive, footer())).toBeGreaterThanOrEqual(4.5);
  });

  it('обычный текст на подвале диалога (muted/50 поверх popover) — не ниже 4.5', () => {
    expect(contrast(vars.foreground, footer())).toBeGreaterThanOrEqual(4.5);
    expect(contrast(vars['muted-foreground'], footer())).toBeGreaterThanOrEqual(4.5);
  });

  it.each(PAIRS)('%s на %s — контраст не ниже 4.5', (fg, bg) => {
    expect(vars[fg], `нет --${fg}`).toBeDefined();
    expect(vars[bg], `нет --${bg}`).toBeDefined();
    expect(contrast(vars[fg], vars[bg])).toBeGreaterThanOrEqual(4.5);
  });

  // Не текст (WCAG 1.4.11 — не ниже 3): знак и значок активного пункта меню, рамка фокуса.
  it.each(UI_PAIRS)('%s на %s (элемент интерфейса) — контраст не ниже 3', (fg, bg) => {
    expect(vars[fg], `нет --${fg}`).toBeDefined();
    expect(vars[bg], `нет --${bg}`).toBeDefined();
    expect(contrast(vars[fg], vars[bg])).toBeGreaterThanOrEqual(3);
  });
});

describe('айдентика', () => {
  const light = block(':root {');
  const dark = block('@media (prefers-color-scheme: dark)');

  it('цвета марки в коде (манифест, theme-color, иконки) совпадают с токенами', () => {
    expect(light.primary).toBe(BRAND_COLORS.primary);
    expect(light.background).toBe(BRAND_COLORS.background);
    expect(dark.primary).toBe(BRAND_COLORS.primaryDark);
    expect(dark.background).toBe(BRAND_COLORS.backgroundDark);
  });

  it('основной цвет — тёплый (терракота), текст на кнопке — светлый в светлой теме и тёмный в тёмной', () => {
    for (const hex of [light.primary, dark.primary]) {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      expect(r).toBeGreaterThan(g);
      expect(g).toBeGreaterThan(b);
    }
    expect(luminance(light['primary-foreground'])).toBeGreaterThan(luminance(light.primary));
    expect(luminance(dark['primary-foreground'])).toBeLessThan(luminance(dark.primary));
  });

  it('иконка вкладки нарисована тем же контуром, что BrandMark', () => {
    const icon = readFileSync(path.resolve(__dirname, '../src/app/icon.svg'), 'utf8');
    expect(icon).toContain(`d="${BRAND_MARK_PATH}"`);
    expect(icon).toContain(BRAND_COLORS.primary);
    expect(icon).toContain(BRAND_COLORS.primaryDark);
  });

  it('манифест: имя, цвета и иконки 192/512, файлы иконок на месте', () => {
    const m = manifest();
    expect(m.name).toBe('Смены Анненкирхе');
    expect(m.short_name).toBe('Анненкирхе');
    expect(m.theme_color).toBe(BRAND_COLORS.primary);
    expect(m.background_color).toBe(BRAND_COLORS.background);
    const sizes = (m.icons ?? []).map((i) => i.sizes);
    expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']));
    for (const icon of m.icons ?? []) {
      const file = path.resolve(__dirname, '../public', `.${icon.src}`);
      const png = readFileSync(file);
      const [w, h] = [png.readUInt32BE(16), png.readUInt32BE(20)];
      expect(`${w}x${h}`).toBe(icon.sizes);
    }
  });
});

describe('destructive-кнопка', () => {
  const button = readFileSync(path.resolve(__dirname, '../src/components/ui/button.tsx'), 'utf8');
  const variant = button.match(/destructive:\s*"([^"]*)"/)?.[1] ?? '';

  it('фон сплошной: без прозрачности, иначе контраст зависит от подложки', () => {
    expect(variant).toMatch(/(^|\s)bg-destructive(\s|$)/);
    expect(variant).not.toMatch(/(^|\s)(dark:)?bg-destructive\//);
  });

  it('текст — токен destructive-foreground', () => {
    expect(variant).toMatch(/(^|\s)text-destructive-foreground(\s|$)/);
  });
});

describe('тема по системе', () => {
  it('не использует класс .dark', () => {
    expect(css).not.toMatch(/@custom-variant\s+dark/);
    expect(css).not.toMatch(/\.dark\s*\{/);
  });
});
