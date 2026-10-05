import type { Tx } from '@/db/client';
import { createSignup, myEarnings, requestCancel, withdrawSignup } from '@/app/(worker)/queries';
import {
  acceptSignup, PERSON_GONE, rejectSignup, resolveCancel, SIGNUP_HANDLED,
} from '@/app/(manager)/event/[id]/operations';
import { UserError, userMessage } from '@/lib/errors';
import { currentMonth } from '@/lib/month';
import type { BotDeps } from './bot';
import { isWorkerCallback, parseCallback, type LoginCallback, type ManagerCallback, type WorkerCallback } from './callbacks';
import { payReply } from './commands';
import type { Db } from './delivery';
import {
  confirmDay, dropCancelButtons, linksOnly, swapSignupButton, toggleCancelButtons, type Keyboard,
} from './keyboards';
import { telegramOwner } from './links';
import { loginLink, LOGIN_SENT, LOGIN_TOO_OFTEN } from './login';
import * as msg from './messages';
import type { CallbackUpdate } from './update';

type Outcome = {
  answer?: string; alert?: boolean;
  /** `replace` — новый текст целиком (не нужен текст из нажатия), иначе правка дописывает к нему. */
  edit?: { text: string; keyboard: Keyboard; replace?: boolean } | null;
  /** Пути для `revalidate` после успешной записи в базу. */
  revalidate?: string[];
};

/** «Отпустить» / «Оставить» по уже рассмотренной отмене: устаревшая кнопка не снимает человека, которого оставили. */
const CANCEL_RESOLVED = 'Отмену уже рассмотрели';
/** Ошибки домена «уже решено»: кнопки убираются, к тексту — «Уже решено в приложении.». */
const DECIDED = new Set([SIGNUP_HANDLED, PERSON_GONE, CANCEL_RESOLVED]);

/** Что обновить после изменения данных — как server actions. */
export const changedPaths = (eventId: string): string[] => ['/shifts', '/available', '/month', `/event/${eventId}`];

/**
 * Нажатие кнопки. Чат → владелец; действие — доменной функцией от его имени. Ответ на нажатие —
 * всегда ровно один: `UserError` — её текстом окном, прочее — общим текстом без подробностей.
 * Сообщение правится после ответа; ошибка правки (например, «не изменено») не мешает.
 */
export async function handleCallback(deps: BotDeps, u: CallbackUpdate): Promise<void> {
  let outcome: Outcome;
  try {
    outcome = await decide(deps, u);
  } catch (error) {
    outcome = { answer: userMessage(error, msg.BOT_FAILED), alert: true };
  }
  if (outcome.revalidate) {
    // Запись уже сохранена: сбой обновления страниц не должен превращать успех в «Не получилось».
    try {
      deps.revalidate(outcome.revalidate);
    } catch {
      console.error('telegram: revalidate failed');
    }
  }
  await deps.api.answerCallbackQuery(u.callbackId, outcome.answer, outcome.alert);
  if (outcome.edit && (u.html !== null || outcome.edit.replace)) {
    await deps.api.editMessageText(u.chatId, u.messageId, outcome.edit.text, outcome.edit.keyboard);
  }
}

async function decide(deps: BotDeps, u: CallbackUpdate): Promise<Outcome> {
  const owner = await deps.anon((tx) => telegramOwner(tx, u.chatId));
  if (!owner) return { answer: msg.HINT_TEXT, alert: true };
  const cb = parseCallback(u.data);
  if (!cb) return { answer: msg.BUTTON_STALE };
  if (isWorkerCallback(cb)) {
    return owner.workerId !== null ? workerButton(deps, owner.workerId, cb, u) : { answer: msg.BUTTON_WRONG_CHAT };
  }
  return owner.isManager ? managerButton(deps, cb, u) : { answer: msg.BUTTON_WRONG_CHAT };
}

/** «‹ / ›» под «Заработком»: тот же ответ за другой месяц, правкой того же сообщения; будущее — «Кнопка устарела». */
async function payMonth(deps: BotDeps, asOwner: Db, workerId: string, month: string): Promise<Outcome> {
  const current = currentMonth(deps.now);
  if (month > current) return { answer: msg.BUTTON_STALE };
  const reply = payReply(month, current, await asOwner((tx) => myEarnings(tx, workerId, month)), deps.origin);
  return { edit: { text: reply.text, keyboard: reply.keyboard, replace: true } };
}

/**
 * «Открыть приложение»: одноразовая ссылка для входа отдельным сообщением в этот же (личный, свой) чат.
 * Сообщение под кнопкой не меняется. Лимит выдачи — окном; Telegram не принял сообщение — «Не получилось».
 */
async function sendLoginLink(deps: BotDeps, asOwner: Db, cb: LoginCallback, u: CallbackUpdate): Promise<Outcome> {
  const link = await loginLink(asOwner, deps.origin, cb.to, u.chatId);
  if (link.kind === 'too_often') return { answer: LOGIN_TOO_OFTEN, alert: true };
  if (link.kind === 'no_https') return { answer: msg.BOT_FAILED, alert: true };
  // Ссылку для входа нельзя переслать или сохранить: protect_content (L5).
  const res = await deps.api.sendMessage(u.chatId, link.text, link.keyboard, { protectContent: true });
  if (res.ok) return { answer: LOGIN_SENT };
  console.error(`telegram: sendMessage failed status=${res.status} description=${res.description}`);
  return { answer: msg.BOT_FAILED, alert: true };
}

async function workerButton(deps: BotDeps, workerId: string, cb: WorkerCallback, u: CallbackUpdate): Promise<Outcome> {
  const asOwner = deps.worker(workerId);
  if (cb.op === 'pm') return payMonth(deps, asOwner, workerId, cb.month);
  if (cb.op === 'lo') return sendLoginLink(deps, asOwner, cb, u);
  const { eventId } = cb;
  const text = u.html ?? '';
  // Кнопки не разобрались — не трогаем их: правка заменила бы их пустой клавиатурой.
  const keyboard = u.keyboard;
  switch (cb.op) {
    case 'su':
      await asOwner((tx) => createSignup(tx, { workerId, eventId }));
      return { answer: 'Заявка подана', revalidate: changedPaths(eventId), edit: keyboard && { text, keyboard: swapSignupButton(keyboard, 'su', eventId) } };
    case 'sw':
      await asOwner((tx) => withdrawSignup(tx, { workerId, eventId }));
      return { answer: 'Заявка отозвана', revalidate: changedPaths(eventId), edit: keyboard && { text, keyboard: swapSignupButton(keyboard, 'sw', eventId) } };
    case 'cx':
    case 'cb':
      // Первый шаг «Не смогу» и «Назад» — без записи в базу.
      return { edit: keyboard && { text, keyboard: toggleCancelButtons(keyboard, cb.op, eventId) } };
    case 'cy': {
      await asOwner((tx) => requestCancel(tx, eventId));
      // Из списка «Моих смен» — итог с днём, кнопки других смен остаются.
      const day = confirmDay(keyboard, eventId);
      const line = day ? msg.cancelRequestedLine(day) : msg.CANCEL_REQUESTED_LINE;
      return { answer: 'Запрос отправлен', revalidate: changedPaths(eventId), edit: { text: msg.appendLine(text, line), keyboard: dropCancelButtons(keyboard, eventId) } };
    }
  }
}

async function managerButton(deps: BotDeps, cb: ManagerCallback, u: CallbackUpdate): Promise<Outcome> {
  const text = u.html ?? '';
  // Кнопки действий убираются, ссылка в приложение остаётся.
  const keyboard = linksOnly(u.keyboard);
  try {
    const done = await deps.manager((tx) => managerAction(tx, cb));
    return {
      answer: done.answer,
      ...(done.eventId ? { revalidate: changedPaths(done.eventId) } : {}),
      edit: { text: msg.appendLine(text, done.line), keyboard },
    };
  } catch (error) {
    if (error instanceof UserError && DECIDED.has(error.message)) {
      return {
        answer: error.message, alert: true,
        edit: { text: msg.appendLine(text, msg.ALREADY_DECIDED_LINE), keyboard },
      };
    }
    throw error;
  }
}

async function managerAction(tx: Tx, cb: ManagerCallback): Promise<{ eventId: string | null; answer: string; line: string }> {
  if (cb.op === 'ma' || cb.op === 'mr') {
    const [signup] = await tx<Array<{ event_id: string }>>`select event_id from signup where id = ${cb.signupId}`;
    const eventId = signup?.event_id ?? null;
    if (cb.op === 'mr') {
      await rejectSignup(tx, cb.signupId);
      return { eventId, answer: 'Заявка отклонена', line: msg.REJECTED_LINE };
    }
    const position = cb.positionId === null ? null
      : (await tx<Array<{ name: string }>>`select name from position where id = ${cb.positionId}`)[0]?.name ?? null;
    await acceptSignup(tx, { signupId: cb.signupId, positionId: cb.positionId });
    return { eventId, answer: 'Принято', line: msg.acceptedLine(position) };
  }
  const pending = await tx`select 1 from assignment
    where event_id = ${cb.eventId} and worker_id = ${cb.workerId} and cancel_requested_at is not null for update`;
  if (pending.length === 0) throw new UserError(CANCEL_RESOLVED);
  const approve = cb.op === 'mo';
  await resolveCancel(tx, { eventId: cb.eventId, workerId: cb.workerId, approve });
  return approve
    ? { eventId: cb.eventId, answer: 'Отпустили', line: msg.RELEASED_LINE }
    : { eventId: cb.eventId, answer: 'Оставили на смене', line: msg.KEPT_LINE };
}
