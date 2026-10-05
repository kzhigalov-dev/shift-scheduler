import type { Tx } from '@/db/client';
import { generateToken, hashToken } from './token';
import type { CurrentWorker } from './workerLookup';
import type { WebAppLoginStatus } from '@/lib/telegram/webApp';

/** Срок кода входа из бота (`issue_worker_login_code` в 0013_review_fixes.sql). */
export const LOGIN_CODE_MINUTES = 15;
/** Не чаще одной выдачи кода за столько секунд на работника (там же). */
export const LOGIN_CODE_EVERY_SECONDS = 30;

/**
 * Одноразовый код входа (32 случайных байта, base64url) на LOGIN_CODE_MINUTES минут — внутри withWorker:
 * владельца функция берёт из личности сессии, `chatId` — чат бота, куда уйдёт ссылка: он обязан быть
 * подключён к этому работнику и запоминается (его отключение гасит код и сессии из него). Прежние коды
 * работника гасятся. null — с прошлой выдачи не прошло LOGIN_CODE_EVERY_SECONDS секунд. Менеджеру,
 * сессии без личности и чужому чату — ошибка прав.
 */
export async function issueWorkerLoginCode(tx: Tx, chatId: number): Promise<string | null> {
  const code = generateToken();
  const [row] = await tx<{ issued: boolean }[]>`select issue_worker_login_code(${hashToken(code)}, ${chatId}) as issued`;
  return row.issued ? code : null;
}

export type LoginCodeState = { state: 'valid' | 'used' | 'expired' | 'invalid'; fullName: string | null };

/**
 * Что с кодом входа — без изменений (страница подтверждения `/tg/[code]` и ответ на повтор).
 * Имя работника — только у действующего кода.
 */
export async function loginCodeState(tx: Tx, code: string): Promise<LoginCodeState> {
  const [row] = await tx<{ state: LoginCodeState['state']; full_name: string | null }[]>`
    select state, full_name from worker_login_code_state(${hashToken(code)})`;
  return row ? { state: row.state, fullName: row.full_name } : { state: 'invalid', fullName: null };
}

/** Закрыть сессию менеджера по токену из своей cookie — без личности, в транзакции входа работника. */
export async function endManagerSessionByToken(tx: Tx, token: string): Promise<void> {
  await tx`select end_manager_session(${hashToken(token)})`;
}

/**
 * Вход по коду — без личности (withAnon): код гасится, создаётся сессия работника на год.
 * Возвращает открытый токен сессии для cookie; код неверный, истёк, использован или работник в архиве — null.
 */
export async function redeemWorkerLoginCode(tx: Tx, code: string): Promise<string | null> {
  const session = generateToken();
  const [row] = await tx<{ ok: boolean }[]>`
    select redeem_worker_login_code(${hashToken(code)}, ${hashToken(session)}) as ok`;
  return row.ok ? session : null;
}

/**
 * Вход по личной ссылке (`personal_link_login`, 0015) — без личности (withAnon): по хешу токена ссылки
 * действующего работника создаётся сессия на год без чата (`chat_id` null: отключение Telegram её не
 * закрывает, перевыпуск ссылки и архив — закрывают). false — ссылка недействительна.
 */
export async function personalLinkLogin(tx: Tx, linkToken: string, session: string): Promise<boolean> {
  const [row] = await tx<{ ok: boolean }[]>`
    select personal_link_login(${hashToken(linkToken)}, ${hashToken(session)}) as ok`;
  return row.ok;
}

/** Работник по токену сессии (без входа — через worker_by_session, security definer). */
export async function workerBySession(tx: Tx, token: string): Promise<CurrentWorker | null> {
  const [row] = await tx<{ id: string; full_name: string }[]>`
    select id, full_name from worker_by_session(${hashToken(token)})`;
  return row ? { id: row.id, fullName: row.full_name } : null;
}

/** Закрыть сессию с этим токеном (свою — токен из своей cookie). */
export async function endWorkerSession(tx: Tx, token: string): Promise<void> {
  await tx`select end_worker_session(${hashToken(token)})`;
}

/** Все сессии, невыданные коды и ключ календаря работника — внутри withManager (перевыпуск ссылки, архив; 0015). */
export async function endWorkerSessions(tx: Tx, workerId: string): Promise<void> {
  await tx`select end_worker_sessions(${workerId})`;
}

/**
 * Вход из Mini App (`webapp_login`, 0013): initData уже проверены (`verifyInitData`). Без личности (withAnon).
 * `session` — токен новой сессии; `current` — токен сессии этого браузера: если это сессия того же
 * работника через тот же чат, новая не создаётся (`kept`). hash initData — защита от повтора.
 */
export async function webAppLogin(
  tx: Tx, auth: { userId: number; authDate: number; hash: string }, session: string, current: string | null,
): Promise<WebAppLoginStatus> {
  const [row] = await tx<{ status: WebAppLoginStatus }[]>`
    select webapp_login(${auth.hash}, ${auth.userId}, to_timestamp(${auth.authDate}), ${hashToken(session)},
      ${current ? hashToken(current) : null}) as status`;
  return row.status;
}
