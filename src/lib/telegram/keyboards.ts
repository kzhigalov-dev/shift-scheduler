import { formatBotDay } from '@/lib/format';
import { loginTarget } from '@/lib/auth/loginTarget';
import { encodeCallback, parseCallback } from './callbacks';

/** Кнопки под сообщением бота. `type`, не `interface`: сериализуются как `JsonObject`. */
export type CallbackButton = { text: string; callback_data: string };
/** Ссылка в приложение — только `https://` (`appButton`). */
export type UrlButton = { text: string; url: string };
/** Кнопка Telegram Mini App: открывает страницу приложения внутри Telegram (только в личных чатах). */
export type WebAppButton = { text: string; web_app: { url: string } };
export type Button = CallbackButton | UrlButton | WebAppButton;
export type Keyboard = { inline_keyboard: Button[][] };

export const isCallbackButton = (b: Button): b is CallbackButton => 'callback_data' in b;
/** Прежняя URL-кнопка (у менеджера — и сейчас); в уже отправленных работникам сообщениях работает как раньше. */
export const OPEN_APP = 'Открыть в приложении';
/** Кнопка входа из бота у работника: Mini App `/tg/app` — приложение открывается сразу, со входом. */
export const OPEN_LOGIN = 'Открыть приложение';
export const MAX_EVENT_LINKS = 5;

export const SIGNUP_PREFIX = 'Записаться: ';
/** «Не смогу: <день>» и «Да, не смогу: <день>» — кнопки под списком «Моих смен». */
export const CANCEL_PREFIX = 'Не смогу: ';
export const CONFIRM_PREFIX = 'Да, не смогу: ';
export const MAX_CANCEL_BUTTONS = 5;
export const WITHDRAW_PREFIX = 'Отозвать: ';
export const MAX_POSITION_BUTTONS = 6;

/** Пустая клавиатура: `editMessageText` с ней убирает кнопки. */
export const noButtons = (): Keyboard => ({ inline_keyboard: [] });

/** URL-кнопка на страницу приложения (`path` — с `/`); адрес не `https://` (локальная разработка) — null. */
export function appButton(origin: string, path: string, text = OPEN_APP): UrlButton | null {
  try {
    const url = new URL(path, origin);
    return url.protocol === 'https:' ? { text, url: url.toString() } : null;
  } catch {
    return null;
  }
}

/**
 * Прежняя кнопка «Открыть приложение» (`lo`) — callback, присылающий одноразовую ссылку `/tg/<код>`.
 * Новые сообщения её не получают (их кнопка — `webAppButton`); нажатия в уже отправленных обрабатываются.
 */
export const loginButton = (to: string, text = OPEN_LOGIN): CallbackButton => ({ text, callback_data: encodeCallback({ op: 'lo', to }) });

/**
 * «Открыть приложение» — Mini App: Telegram открывает `/tg/app?to=<путь>` внутри себя и передаёт подписанные
 * initData, страница входит по ним без ссылки и лишнего сообщения. Путь — только из белого списка
 * (`loginTarget`); адрес не `https://` (локально) — null.
 */
export function webAppButton(origin: string, to: string, text = OPEN_LOGIN): WebAppButton | null {
  const link = appButton(origin, `/tg/app?${new URLSearchParams({ to: loginTarget(to) })}`, text);
  return link ? { text, web_app: { url: link.url } } : null;
}

/** Ссылка в приложение — URL-кнопка, Mini App или прежняя кнопка входа: остаётся при правках, новые кнопки встают перед ней. */
export const isAppLink = (b: Button): boolean => !isCallbackButton(b) || parseCallback(b.callback_data)?.op === 'lo';

/**
 * Работнику: кнопки действий и последней строкой — «Открыть приложение» (Mini App со входом, затем `to`).
 * Только `https://`: локально по `http://` кнопки нет, как у `withAppLink`. Менеджеру — `withAppLink`.
 */
export function withLoginButton(keyboard: Keyboard | null, origin: string, to: string, text = OPEN_LOGIN): Keyboard | null {
  const rows = keyboard?.inline_keyboard ?? [];
  const open = webAppButton(origin, to, text);
  const all = open ? [...rows, [open]] : rows;
  return all.length > 0 ? { inline_keyboard: all } : null;
}

/** Кнопки действий и последней строкой — ссылка в приложение; нет ни того, ни другого — null. */
export function withAppLink(keyboard: Keyboard | null, origin: string, path: string, text = OPEN_APP): Keyboard | null {
  const rows = keyboard?.inline_keyboard ?? [];
  const link = appButton(origin, path, text);
  const all = link ? [...rows, [link]] : rows;
  return all.length > 0 ? { inline_keyboard: all } : null;
}

/**
 * «Не хватает людей»: ссылка на каждое мероприятие (не больше MAX_EVENT_LINKS) с подписью «пт, 10 июл., 20:00»;
 * мероприятий больше — последней строкой «Открыть в приложении» на `/month`. Не https — null.
 */
export function understaffedKeyboard(items: ReadonlyArray<{ eventId: string; date: string; start: string }>, origin: string): Keyboard | null {
  const rows = items.slice(0, MAX_EVENT_LINKS)
    .map((e) => appButton(origin, `/event/${e.eventId}`, `${formatBotDay(e.date, 'short')}, ${e.start}`))
    .filter((b): b is UrlButton => b !== null)
    .map((b) => [b]);
  const more = items.length > MAX_EVENT_LINKS ? appButton(origin, '/month') : null;
  const all = more ? [...rows, [more]] : rows;
  return all.length > 0 ? { inline_keyboard: all } : null;
}

/** После окончательного действия: кнопки действий убираются, ссылки в приложение остаются. */
export function linksOnly(keyboard: Keyboard | null): Keyboard {
  const rows = (keyboard?.inline_keyboard ?? [])
    .map((row) => row.filter(isAppLink))
    .filter((row) => row.length > 0);
  return { inline_keyboard: rows };
}

export const signupButton = (eventId: string, text = 'Записаться'): CallbackButton =>
  ({ text, callback_data: encodeCallback({ op: 'su', eventId }) });
export const withdrawButton = (eventId: string, text = 'Отозвать заявку'): CallbackButton =>
  ({ text, callback_data: encodeCallback({ op: 'sw', eventId }) });
export const cancelButton = (eventId: string, text = 'Не смогу'): CallbackButton =>
  ({ text, callback_data: encodeCallback({ op: 'cx', eventId }) });
/** Подтверждение «Не смогу»; `day` — подпись дня из списка «Моих смен» («Да, не смогу: пт, 10 июл.»). */
export const cancelConfirmButtons = (eventId: string, day?: string): CallbackButton[] => [
  { text: day ? `${CONFIRM_PREFIX}${day}` : 'Да, не смогу', callback_data: encodeCallback({ op: 'cy', eventId }) },
  { text: 'Назад', callback_data: encodeCallback({ op: 'cb', eventId }) },
];

/** «Не смогу» у назначения и напоминаний — если смена не в прошлом (`today` — дата по Москве). */
export function shiftKeyboard(eventId: string, date: string, today: string): Keyboard | null {
  return date < today ? null : { inline_keyboard: [[cancelButton(eventId)]] };
}

/** Заявка: «Принять · <должность>» по строке на свободную должность (не больше 6); нет таких — «Принять»; последней — «Отклонить». */
export function managerSignupKeyboard(signupId: string, positions: ReadonlyArray<{ id: string; name: string }>): Keyboard {
  const accept: CallbackButton[][] = positions.length > 0
    ? positions.slice(0, MAX_POSITION_BUTTONS).map((p) => [
      { text: `Принять · ${p.name}`, callback_data: encodeCallback({ op: 'ma', signupId, positionId: p.id }) },
    ])
    : [[{ text: 'Принять', callback_data: encodeCallback({ op: 'ma', signupId, positionId: null }) }]];
  return { inline_keyboard: [...accept, [{ text: 'Отклонить', callback_data: encodeCallback({ op: 'mr', signupId }) }]] };
}

export function managerCancelKeyboard(eventId: string, workerId: string): Keyboard {
  return { inline_keyboard: [[
    { text: 'Отпустить', callback_data: encodeCallback({ op: 'mo', eventId, workerId }) },
    { text: 'Оставить', callback_data: encodeCallback({ op: 'mk', eventId, workerId }) },
  ]] };
}

/**
 * Первая подходящая кнопка заменяется на `replacement` (в той же строке), остальные подходящие
 * убираются, пустые строки выпадают. Ничего не подошло — `replacement` новой строкой перед
 * ссылками в приложение (они остаются последними), если её кнопок ещё нет.
 */
export function replaceButtons(keyboard: Keyboard, match: (b: CallbackButton) => boolean, replacement: CallbackButton[]): Keyboard {
  let placed = false;
  const rows: Button[][] = [];
  for (const row of keyboard.inline_keyboard) {
    const next: Button[] = [];
    for (const b of row) {
      if (!isCallbackButton(b) || !match(b)) next.push(b);
      else if (!placed) {
        next.push(...replacement);
        placed = true;
      }
    }
    if (next.length > 0) rows.push(next);
  }
  if (!placed) {
    // Устаревшее или повторное нажатие: новые кнопки уже стоят под сообщением — не дублируем их.
    const present = new Set(keyboard.inline_keyboard.flat().filter(isCallbackButton).map((b) => b.callback_data));
    if (replacement.every((b) => present.has(b.callback_data))) return keyboard;
    let at = rows.length;
    while (at > 0 && rows[at - 1].every(isAppLink)) at -= 1;
    rows.splice(at, 0, replacement);
  }
  return { inline_keyboard: rows };
}

/** `su` → нажатая кнопка становится «Отозвать…», `sw` → «Записаться…»; подпись с датой из списка `/free` сохраняется. */
export function swapSignupButton(keyboard: Keyboard, op: 'su' | 'sw', eventId: string): Keyboard {
  const data = encodeCallback({ op, eventId });
  const label = keyboard.inline_keyboard.flat().filter(isCallbackButton).find((b) => b.callback_data === data)?.text ?? '';
  const next = op === 'su'
    ? withdrawButton(eventId, label.startsWith(SIGNUP_PREFIX) ? `${WITHDRAW_PREFIX}${label.slice(SIGNUP_PREFIX.length)}` : undefined)
    : signupButton(eventId, label.startsWith(WITHDRAW_PREFIX) ? `${SIGNUP_PREFIX}${label.slice(WITHDRAW_PREFIX.length)}` : undefined);
  return replaceButtons(keyboard, (b) => b.callback_data === data, [next]);
}

/** Подпись кнопки с данными `data` без приставки `prefix`; приставки нет — undefined. */
function labelAfter(keyboard: Keyboard | null, data: string, prefix: string): string | undefined {
  const text = keyboard?.inline_keyboard.flat().filter(isCallbackButton).find((b) => b.callback_data === data)?.text ?? '';
  return text.startsWith(prefix) ? text.slice(prefix.length) : undefined;
}

/** `cx` → пара «Да, не смогу» / «Назад»; `cb` → обратно «Не смогу». День в подписи (список «Моих смен») сохраняется. */
export function toggleCancelButtons(keyboard: Keyboard, op: 'cx' | 'cb', eventId: string): Keyboard {
  if (op === 'cx') {
    const data = encodeCallback({ op: 'cx', eventId });
    const day = labelAfter(keyboard, data, CANCEL_PREFIX);
    return replaceButtons(keyboard, (b) => b.callback_data === data, cancelConfirmButtons(eventId, day));
  }
  const day = confirmDay(keyboard, eventId);
  const pair = new Set(cancelConfirmButtons(eventId).map((b) => b.callback_data));
  return replaceButtons(keyboard, (b) => pair.has(b.callback_data), [cancelButton(eventId, day ? `${CANCEL_PREFIX}${day}` : undefined)]);
}

/** День из «Да, не смогу: <день>» (нажали в списке «Моих смен»); у уведомления — undefined. */
export const confirmDay = (keyboard: Keyboard | null, eventId: string): string | undefined =>
  labelAfter(keyboard, encodeCallback({ op: 'cy', eventId }), CONFIRM_PREFIX);

/** После «Да, не смогу»: кнопки этой смены убираются, остальные (другие смены, ссылки) остаются. */
export function dropCancelButtons(keyboard: Keyboard | null, eventId: string): Keyboard {
  const own = new Set((['cx', 'cy', 'cb'] as const).map((op) => encodeCallback({ op, eventId })));
  const rows = (keyboard?.inline_keyboard ?? [])
    .map((row) => row.filter((b) => !isCallbackButton(b) || !own.has(b.callback_data)))
    .filter((row) => row.length > 0);
  return { inline_keyboard: rows };
}
