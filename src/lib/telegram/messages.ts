import { formatDate, formatMoneyRange, pluralRu } from '@/lib/format';
import type { RateRange } from '@/lib/pay/calculatePay';
import { monthName as monthNameRu } from '@/lib/month';
import { clipHtml, escapeHtml, visibleLength } from './html';

/**
 * Тексты бота — HTML (`parse_mode: 'HTML'`). Первая строка — значок и жирный заголовок, ниже —
 * строки «что / когда / где». Всё из базы и от людей — только через `escapeHtml`. Ссылок в тексте нет:
 * работнику — кнопка входа «Открыть приложение» (`withLoginButton`), менеджеру — URL-кнопка (`withAppLink`).
 */
export type ShiftInfo = { date: string; start: string; arrive: string | null; concert: string | null; position: string | null };
const NBSP = ' ';
/** «Пт, 3 октября». */
export const dayTitle = (date: string): string => formatDate(date, { weekday: 'short' });
/** «Приход 18:00 · начало 20:00» или «Начало 20:00». */
export const timesLine = (s: { start: string; arrive: string | null }): string =>
  (s.arrive ? `Приход ${s.arrive} · начало ${s.start}` : `Начало ${s.start}`);
/** «сентябрь» — название месяца `YYYY-MM` без года, со строчной. */
export const monthName = (month: string): string => monthNameRu(month);
const places = (n: number) => `${n}${NBSP}${pluralRu(n, ['место', 'места', 'мест'])}`;
/** Свободное место; `rate` — ставка, которую работник получит (`rateRange`), null/нет — без строки ставки. */
export type PlaceInfo = { date: string; start: string; concert: string | null; free: number; rate?: RateRange | null };
/** Строка списка: «• Пт, 3 октября, 20:00 — Лунный свет: 2 места · 1 500–2 000 ₽». */
const placeItem = (e: PlaceInfo) =>
  `• ${dayTitle(e.date)}, ${e.start} — ${escapeHtml(e.concert ?? 'мероприятие')}: ${places(e.free)}${e.rate ? ` · ${formatMoneyRange(e.rate)}` : ''}`;

/** Заголовок (значок и жирный текст без данных из базы) и строки под ним. */
const card = (icon: string, title: string, lines: string[]): string => [`${icon} <b>${title}</b>`, ...lines].join('\n');

/** 🗓 день, 🕕 время, 🎵 название (если есть), 👤 должность (если `withPosition`; нет — «Без должности»). */
export function shiftLines(s: ShiftInfo, withPosition: boolean): string[] {
  return [
    `🗓 ${dayTitle(s.date)}`,
    `🕕 ${timesLine(s)}`,
    ...(s.concert ? [`🎵 ${escapeHtml(s.concert)}`] : []),
    ...(withPosition ? [`👤 ${escapeHtml(s.position ?? 'Без должности')}`] : []),
  ];
}

export const assignedText = (s: ShiftInfo) => card('✅', 'Вас поставили на смену', shiftLines(s, true));
export const removedText = (s: ShiftInfo) => card('❌', 'Вас сняли со смены', shiftLines(s, false));
export const cancelApprovedText = (s: ShiftInfo) => card('👌', 'Отмену одобрили', shiftLines(s, false));
export const keptText = (s: ShiftInfo) => card('📌', 'Менеджер оставил вас на смене', shiftLines(s, true));
export const eventCancelledText = (s: ShiftInfo) => card('🚫', 'Мероприятие отменено', shiftLines(s, false));
export const rejectedText = (s: ShiftInfo) => card('🙅', 'Заявку отклонили', shiftLines(s, false));
export const timeChangedText = (s: ShiftInfo) => card('🔄', 'Изменилось время смены', shiftLines(s, true));
export const eveningReminderText = (s: ShiftInfo) => card('⏰', 'Завтра смена', shiftLines(s, true));
export const beforeReminderText = (s: ShiftInfo, hours: number) =>
  card('⏰', `Через ${hours}${NBSP}${pluralRu(hours, ['час', 'часа', 'часов'])} смена`, shiftLines(s, true));
export const publishedText = (m: { month: string; shifts: number; free: number }) =>
  card('🗓', `Опубликованы смены на ${monthName(m.month)}`, [
    `У вас ${m.shifts}${NBSP}${pluralRu(m.shifts, ['смена', 'смены', 'смен'])}.`,
    ...(m.free > 0 ? [`Свободных мест: ${m.free}.`] : []),
  ]);
export const freePlaceText = (e: PlaceInfo) =>
  card('🙋', 'Нужен человек', [
    ...shiftLines({ ...e, arrive: null, position: null }, false),
    ...(e.rate ? [`💰 ${formatMoneyRange(e.rate)}`] : []),
    `Свободно мест: ${e.free}`,
  ]);
/** Свободные места на нескольких мероприятиях одной правки (например, применение шаблона вида) — одним сообщением. */
export const freePlacesText = (items: PlaceInfo[]) =>
  card('🙋', 'Нужны люди', items.map(placeItem));
type RequestInfo = { name: string; date: string; concert: string | null };
const requestLines = (e: RequestInfo) => [
  `👤 ${escapeHtml(e.name)}`, `🗓 ${dayTitle(e.date)}`, ...(e.concert ? [`🎵 ${escapeHtml(e.concert)}`] : []),
];
export const managerSignupText = (e: RequestInfo) => card('📥', 'Новая заявка', requestLines(e));
export const managerCancelText = (e: RequestInfo) => card('⚠️', 'Не сможет выйти', requestLines(e));
export const understaffedText = (items: Array<{ date: string; start: string; concert: string | null; free: number }>) =>
  card('⚠️', 'Не хватает людей', items.map(placeItem));

/** Перебор пароля менеджера со многих адресов (`login_under_attack`, 0015) — не чаще раза в час. */
export const LOGIN_ATTACK_TEXT = card('🔐', 'Подбирают пароль менеджера', [
  'За последний час — больше 100 неверных паролей с разных адресов. Вход с них ограничен строже.',
  'Если это не вы — смените пароль менеджера (README, «Пароль менеджера на бою»).',
]);

/** Предел Telegram — 4096 символов видимого текста (UTF-16); с запасом. */
export const MAX_TEXT = 4000;
/** HTML сообщения не длиннее MAX_TEXT видимых символов: режется содержимое, теги закрываются. */
export const clipText = (html: string): string => clipHtml(html, MAX_TEXT);

/**
 * Итог нажатия под HTML сообщения — через пустую строку, курсивом; `line` — простой текст
 * (экранируется). Длинный текст обрезается, итог остаётся целым.
 */
export function appendLine(html: string, line: string): string {
  const tail = `<i>${escapeHtml(line)}</i>`;
  const room = Math.max(0, MAX_TEXT - visibleLength(tail) - 2);
  return `${clipHtml(html, room)}\n\n${tail}`;
}

export const CANCEL_REQUESTED_LINE = 'Отмена запрошена — ждём решения менеджера.';
/** Итог «Да, не смогу» под списком «Моих смен»: какой день. */
export const cancelRequestedLine = (day: string) => `Отмена запрошена: ${day} — ждём решения менеджера.`;
export const ALREADY_DECIDED_LINE = 'Уже решено в приложении.';
export const REJECTED_LINE = 'Заявка отклонена.';
export const RELEASED_LINE = 'Отпустили.';
export const KEPT_LINE = 'Оставили на смене.';
export const acceptedLine = (position: string | null) => `✓ Принято: ${position ?? 'без должности'}.`;

/** Ответ на /open: кнопка Mini App под ним открывает приложение уже со входом. */
export const OPEN_TEXT = '📱 <b>Приложение</b>\nНажмите кнопку — приложение откроется в Telegram, входить не нужно.';

export const BUTTON_STALE = 'Кнопка устарела';
export const BUTTON_WRONG_CHAT = 'Кнопка не для этого чата';
export const BOT_FAILED = 'Не получилось, попробуйте в приложении';

/** Без разметки: ещё и текст окна при нажатии кнопки в неподключённом чате (там HTML не работает). */
export const HINT_TEXT = 'Это бот смен Анненкирхе. Подключитесь из приложения: «Уведомления» → «Подключить Telegram».';
export const START_STALE_TEXT = 'Ссылка устарела — нажмите «Подключить Telegram» в приложении ещё раз.';
const menuHint = (isManager: boolean) => (isManager ? 'заявки и отмены, нехватка' : 'смены, свободные места, заработок');
export const startOkText = (isManager: boolean) =>
  card('✅', 'Готово!', [
    'Теперь уведомления будут приходить сюда. Настроить их — в приложении, раздел «Уведомления».',
    `Внизу чата — меню: ${menuHint(isManager)}.`,
  ]);
export const linkedText = (isManager: boolean) =>
  card('✅', 'Чат подключён', [
    'Уведомления уже подключены к этому чату. Настроить их — в приложении, раздел «Уведомления».',
    `Внизу чата — меню: ${menuHint(isManager)}.`,
  ]);
