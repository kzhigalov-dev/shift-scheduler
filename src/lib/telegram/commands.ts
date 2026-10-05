import type { Tx } from '@/db/client';
import {
  availableEvents, myEarnings, myShifts, type AvailableEvent, type Shift,
} from '@/app/(worker)/queries';
import { userMessage } from '@/lib/errors';
import { formatBotDay, formatMoney, formatMoneyRange, pluralRu } from '@/lib/format';
import { currentMonth, shiftMonth } from '@/lib/month';
import type { BotDeps, Owner } from './bot';
import { encodeCallback } from './callbacks';
import { botUsername } from './config';
import { escapeHtml } from './html';
import {
  cancelButton, CANCEL_PREFIX, managerCancelKeyboard, MAX_CANCEL_BUTTONS, signupButton, SIGNUP_PREFIX,
  understaffedKeyboard, webAppButton, withAppLink, withdrawButton, WITHDRAW_PREFIX, withLoginButton,
  type Button, type CallbackButton, type Keyboard,
} from './keyboards';
import { telegramOwner } from './links';
import { signupRequestMarkup } from './markup';
import {
  MANAGER_COMMANDS, menuCommand, menuKeyboard, removeKeyboard, WORKER_COMMANDS,
  type BotCommand, type MenuKeyboard, type RemoveKeyboard,
} from './menu';
import {
  BOT_FAILED, dayTitle, HINT_TEXT, managerCancelText, managerSignupText, monthName, OPEN_TEXT, timesLine, understaffedText,
} from './messages';
import { understaffedItems, UNDERSTAFFED_DAYS } from './process';
import { moscowNow } from './reminders';

export const SHIFTS_LIMIT = 10;
export const FREE_LIMIT = 5;
export const REQUESTS_LIMIT = 10;

const NBSP = ' ';
const COMMAND = /^\/([A-Za-z0-9_]{1,32})(?:@([A-Za-z0-9_]+))?(?:\s|$)/;

/** Inline-кнопки под ответом или постоянное меню (вместе в одном сообщении нельзя). */
export type ReplyMarkup = Keyboard | MenuKeyboard | RemoveKeyboard;
export type Reply = { text: string; keyboard: ReplyMarkup | null };
/** Ответ с inline-кнопками (его же можно править после нажатия). */
export type InlineReply = { text: string; keyboard: Keyboard | null };

/** `/имя` или `/имя@DemoShiftsBot` (регистр не важен, аргументы игнорируются); чужой бот и прочий текст — null. */
export function parseCommand(text: string): string | null {
  const m = COMMAND.exec(text.trim());
  if (!m) return null;
  if (m[2] && m[2].toLowerCase() !== botUsername().toLowerCase()) return null;
  return m[1].toLowerCase();
}

export const helpReply = (commands: BotCommand[]): string =>
  `❓ <b>Помощь</b>\nВыберите действие в меню внизу чата или отправьте команду:\n${
    commands.map((c) => `/${c.command} — ${c.description.toLowerCase()}`).join('\n')}`;

/**
 * Настройки — кнопкой «Открыть настройки»: у работника — входом из бота на `/notifications`,
 * у менеджера — URL-кнопкой на `/telegram` (менеджер входит паролем).
 */
export function settingsReply(origin: string, path: '/notifications' | '/telegram'): InlineReply {
  return {
    text: '⚙️ <b>Настройки</b>\nКакие уведомления присылать и когда напоминать — настраивается в приложении.',
    keyboard: path === '/notifications'
      ? withLoginButton(null, origin, path, 'Открыть настройки')
      : withAppLink(null, origin, path, 'Открыть настройки'),
  };
}

/** Смена списком: дата жирным, время, название, должность, «Отмена запрошена» курсивом. */
function shiftBlock(s: Shift): string {
  return [
    `<b>${dayTitle(s.date)}</b>`,
    `🕕 ${timesLine({ start: s.startTime, arrive: s.arriveTime })}`,
    ...(s.concert ? [`🎵 ${escapeHtml(s.concert)}`] : []),
    `👤 ${escapeHtml(s.position ?? 'Без должности')}`,
    ...(s.cancelRequested ? ['<i>Отмена запрошена</i>'] : []),
  ].join('\n');
}

/**
 * Ближайшие смены (до 10) блоками через пустую строку. Под ответом — «Не смогу: <день>» для ближайших
 * смен без запрошенной отмены (до 5; подтверждение — как в уведомлениях) и ссылка в приложение.
 */
export function shiftsReply(shifts: Shift[], origin: string): InlineReply {
  const title = '📅 <b>Ваши ближайшие смены</b>';
  const list = shifts.slice(0, SHIFTS_LIMIT);
  const rows: Button[][] = list.filter((s) => !s.cancelRequested).slice(0, MAX_CANCEL_BUTTONS)
    .map((s) => [cancelButton(s.eventId, `${CANCEL_PREFIX}${dayLabel(list, s.date, s.startTime)}`)]);
  return {
    text: list.length === 0 ? `${title}\nБлижайших смен нет.` : [title, ...list.map(shiftBlock)].join('\n\n'),
    keyboard: withLoginButton(rows.length > 0 ? { inline_keyboard: rows } : null, origin, '/shifts'),
  };
}

const STATUS_SUFFIX: Record<NonNullable<AvailableEvent['signupStatus']>, string> = {
  pending: ' · <i>заявка подана</i>', accepted: ' · <i>заявка принята</i>', rejected: ' · <i>заявку отклонили</i>',
};

/** Подпись кнопки «пт, 10 июл.»; два мероприятия в один день — ещё и время, иначе кнопки не различить. */
function dayLabel(list: ReadonlyArray<{ date: string }>, date: string, time: string): string {
  const day = formatBotDay(date, 'short');
  return list.filter((x) => x.date === date).length > 1 ? `${day}, ${time}` : day;
}

/** Список «Свободных» (как в приложении), ближайшие 5; под сообщением — «Записаться: <день>» или «Отозвать: <день>» и ссылка. */
export function freeReply(events: AvailableEvent[], origin: string): InlineReply {
  const title = '🙋 <b>Свободные места</b>';
  const list = events.slice(0, FREE_LIMIT);
  if (list.length === 0) return { text: `${title}\nСвободных мест пока нет.`, keyboard: withLoginButton(null, origin, '/available') };
  const lines = list.map((e) =>
    `• ${dayTitle(e.date)}, ${e.startTime} — ${escapeHtml(e.concert ?? 'мероприятие')}`
    + `${e.rate ? ` · ${formatMoneyRange(e.rate)}` : ''}${e.signupStatus ? STATUS_SUFFIX[e.signupStatus] : ''}`);
  const rows: Button[][] = list.flatMap((e) => {
    const label = dayLabel(list, e.date, e.startTime);
    if (e.signupStatus === null) return [[signupButton(e.eventId, `${SIGNUP_PREFIX}${label}`)]];
    if (e.signupStatus === 'pending') return [[withdrawButton(e.eventId, `${WITHDRAW_PREFIX}${label}`)]];
    return [];
  });
  return {
    text: [title, ...lines].join('\n'),
    keyboard: withLoginButton(rows.length > 0 ? { inline_keyboard: rows } : null, origin, '/available'),
  };
}

/** «сентябрь»; месяц другого года (относительно `current`) — «декабрь 2098». */
export function monthLabel(month: string, current: string): string {
  return month.slice(0, 4) === current.slice(0, 4) ? monthName(month) : `${monthName(month)} ${month.slice(0, 4)}`;
}

/** «‹ август» и (не дальше текущего месяца) «октябрь ›»; последней строкой — «Открыть приложение» на этот месяц. */
export function payKeyboard(month: string, current: string, origin: string): Keyboard {
  const prev = shiftMonth(month, -1);
  const next = shiftMonth(month, 1);
  const nav: CallbackButton[] = [{ text: `‹ ${monthLabel(prev, current)}`, callback_data: encodeCallback({ op: 'pm', month: prev }) }];
  if (next <= current) nav.push({ text: `${monthLabel(next, current)} ›`, callback_data: encodeCallback({ op: 'pm', month: next }) });
  const link = webAppButton(origin, `/earnings?month=${month}`);
  return { inline_keyboard: link ? [nav, [link]] : [nav] };
}

/** «💰 Заработок · сентябрь» и «6 смен — 7 800 ₽» за месяц `month`; `current` — текущий месяц по Москве. */
export function payReply(
  month: string, current: string, e: { shifts: number; total: number; unpriced: number }, origin: string,
): { text: string; keyboard: Keyboard } {
  const lines = [
    `💰 <b>Заработок · ${monthLabel(month, current)}</b>`,
    `${e.shifts}${NBSP}${pluralRu(e.shifts, ['смена', 'смены', 'смен'])} — <b>${formatMoney(e.total)}</b>`,
  ];
  if (e.unpriced > 0) lines.push(`Без ставки: ${e.unpriced} (уточняется).`);
  return { text: lines.join('\n'), keyboard: payKeyboard(month, current, origin) };
}

type RequestRow = { kind: 'signup' | 'cancel'; event_id: string; worker_id: string; name: string; date: string; concert: string | null };

/** Ожидающие заявки и запрошенные отмены на будущие опубликованные мероприятия — по сообщению с кнопками, не больше 10. */
async function requestsReplies(tx: Tx, today: string, origin: string): Promise<Reply[]> {
  const rows = await tx<RequestRow[]>`
    select x.kind, x.event_id, x.worker_id, x.name, to_char(x.event_date, 'YYYY-MM-DD') as date, x.concert from (
      select 'signup' as kind, g.event_id, g.worker_id, w.full_name as name, e.event_date, e.start_time, e.concert, g.created_at as at
      from signup g join event e on e.id = g.event_id join worker w on w.id = g.worker_id
      where g.status = 'pending'
      union all
      select 'cancel', a.event_id, a.worker_id, w.full_name, e.event_date, e.start_time, e.concert, a.cancel_requested_at
      from assignment a join event e on e.id = a.event_id join worker w on w.id = a.worker_id
      where a.cancel_requested_at is not null
    ) x
    where x.event_date >= ${today}::date
      and exists (select 1 from month m where m.month = to_char(x.event_date, 'YYYY-MM') and m.status = 'published')
    order by x.event_date, x.start_time, x.at`;
  if (rows.length === 0) return [{ text: '📥 <b>Заявок и отмен нет</b>', keyboard: null }];
  const replies: Reply[] = [];
  for (const r of rows.slice(0, REQUESTS_LIMIT)) {
    const data = { name: r.name, date: r.date, concert: r.concert };
    const actions = r.kind === 'signup' ? await signupRequestMarkup(tx, r.event_id, r.worker_id) : managerCancelKeyboard(r.event_id, r.worker_id);
    replies.push({
      text: r.kind === 'signup' ? managerSignupText(data) : managerCancelText(data),
      keyboard: withAppLink(actions, origin, `/event/${r.event_id}`),
    });
  }
  if (rows.length > REQUESTS_LIMIT) {
    replies.push({ text: `И ещё ${rows.length - REQUESTS_LIMIT} — в приложении.`, keyboard: withAppLink(null, origin, '/month') });
  }
  return replies;
}

async function commandReplies(deps: BotDeps, owner: Owner, command: string | null): Promise<Reply[]> {
  const { origin } = deps;
  const one = (text: string, keyboard: ReplyMarkup | null = null): Reply[] => [{ text, keyboard }];
  // Помощь (и ответ на непонятный текст) — с постоянным меню своей роли.
  const help = (commands: BotCommand[]) => one(helpReply(commands), menuKeyboard(owner.workerId === null));
  if (owner.workerId !== null) {
    const workerId = owner.workerId;
    const asOwner = deps.worker(workerId);
    switch (command) {
      case 'shifts':
        return [shiftsReply(await asOwner((tx) => myShifts(tx, workerId)), origin)];
      case 'free':
        return [freeReply(await asOwner((tx) => availableEvents(tx, workerId)), origin)];
      case 'pay': {
        const month = currentMonth(deps.now);
        return [payReply(month, month, await asOwner((tx) => myEarnings(tx, workerId, month)), origin)];
      }
      case 'settings':
        return [settingsReply(origin, '/notifications')];
      case 'open': {
        // Кнопка Mini App «Открыть приложение» — без ссылки и кода; в меню пункта нет.
        const keyboard = withLoginButton(null, origin, '/shifts');
        return keyboard ? one(OPEN_TEXT, keyboard) : one(BOT_FAILED);
      }
      default:
        return help(WORKER_COMMANDS);
    }
  }
  const today = moscowNow(deps.now).date;
  switch (command) {
    case 'requests':
      return deps.manager((tx) => requestsReplies(tx, today, origin));
    case 'understaffed': {
      const items = await deps.manager((tx) => understaffedItems(tx, today, UNDERSTAFFED_DAYS));
      return items.length > 0 ? one(understaffedText(items), understaffedKeyboard(items, origin)) : one('✅ <b>Нехватки нет</b>');
    }
    case 'settings':
      return [settingsReply(origin, '/telegram')];
    default:
      return help(MANAGER_COMMANDS);
  }
}

/**
 * Текст из личного чата: неподключённому — подсказка (и меню убирается); подключённому — ответ
 * на команду или кнопку меню от имени владельца, прочий текст — помощь с меню. Ответы — сразу
 * `sendMessage`, не через очередь.
 */
export async function handleText(deps: BotDeps, chatId: number, text: string): Promise<void> {
  const owner = await deps.anon((tx) => telegramOwner(tx, chatId));
  if (!owner) {
    await deps.api.sendMessage(chatId, HINT_TEXT, removeKeyboard());
    return;
  }
  let replies: Reply[];
  try {
    replies = await commandReplies(deps, owner, parseCommand(text) ?? menuCommand(text));
  } catch (error) {
    replies = [{ text: escapeHtml(userMessage(error, BOT_FAILED)), keyboard: null }];
  }
  for (const r of replies) {
    const res = await deps.api.sendMessage(chatId, r.text, r.keyboard ?? undefined);
    if (res.ok) continue;
    // Без текста сообщения и ключа бота: только что ответил Telegram. 429 — лимит чата, остальное слать бессмысленно.
    console.error(`telegram: sendMessage failed status=${res.status} description=${res.description}`);
    if (res.status === 429) break;
  }
}
