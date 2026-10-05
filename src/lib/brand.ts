// Айдентика Анненкирхе: данные, которые нужны вне CSS (манифест, theme-color, иконки).
// Цвета обязаны совпадать с токенами globals.css — это проверяет tests/theme.test.ts.
// Спецификация: docs/superpowers/specs/2026-09-30-identity-design.md.

export const BRAND_NAME = 'Смены Анненкирхе';
export const BRAND_SHORT_NAME = 'Анненкирхе';

export const BRAND_COLORS = {
  /** --primary светлой темы: терракота, «обожжённый кирпич». */
  primary: '#a4492c',
  /** --primary тёмной темы. */
  primaryDark: '#e39a78',
  /** --background светлой темы. */
  background: '#fbf9f6',
  /** --background тёмной темы. */
  backgroundDark: '#1b1917',
} as const;

/**
 * Знак — силуэт колокольни, нарисованный с нуля в сетке 32×32: шпиль, купол,
 * ярус звона с арочным проёмом, карниз, нижний ярус с круглым окном.
 * Ярусы сужаются ступенями по чётным координатам — на 16 px края попадают в пиксели.
 * Проёмы — контуры против часовой стрелки (правило nonzero).
 */
export const BRAND_MARK_PATH =
  'M16 0L17.5 11H14.5Z'
  + 'M12 14A4 4 0 0 1 20 14Z'
  + 'M11 14H21V22H11Z'
  + 'M14 20H18V18A2 2 0 0 0 14 18Z'
  + 'M9 22H23V24H9Z'
  + 'M10 24H22V32H10Z'
  + 'M18 28A2 2 0 0 0 14 28A2 2 0 0 0 18 28Z';
