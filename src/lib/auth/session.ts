import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { withAnon, withManager, type Tx } from '@/db/client';
import { findWorkerBySession, findWorkerByToken, type CurrentWorker } from './workerLookup';
import {
  createManagerSession, isManagerSessionValid, deleteManagerSession, MANAGER_SESSION_HOURS,
} from './managerSession';
import {
  endManagerSessionByToken, endWorkerSession, personalLinkLogin, redeemWorkerLoginCode, webAppLogin,
} from './workerSession';
import { generateToken } from './token';
import { cookieName, LEGACY_WORKER_TOKEN, securedCookies, type CookieBase } from './cookieNames';
import { isTokenShape } from './workerLookup';
import type { WebAppAuth, WebAppLoginStatus } from '@/lib/telegram/webApp';

export type { CurrentWorker };

/**
 * Cookie входа (имена — `cookieNames.ts`):
 * - `worker_session` — токен сессии работника (личная ссылка, код из бота, Mini App);
 * - `manager_session` — токен сессии менеджера;
 * - `worker_token` — до 0015 в ней лежал сам токен личной ссылки (L6); теперь только читается
 *   и при первой возможности меняется на сессию (`upgradeLegacyCookies`).
 */
const MANAGER: CookieBase = 'manager_session';
const WORKER: CookieBase = 'worker_session';
const YEAR = 60 * 60 * 24 * 365;

type Jar = Awaited<ReturnType<typeof cookies>>;

const options = () => ({ httpOnly: true, secure: securedCookies(), sameSite: 'lax' as const, path: '/' });

/** Значение cookie роли: под нынешним именем, а в переходный период — и под прежним (без `__Host-`). */
function read(jar: Jar, base: CookieBase): string | undefined {
  return jar.get(cookieName(base))?.value || jar.get(base)?.value || undefined;
}

/**
 * Удалить cookie. Удаление — тоже Set-Cookie: для `__Host-` браузер примет его только с Secure и Path=/,
 * поэтому атрибуты — те же, что при записи.
 */
function clear(jar: Jar, name: string): void {
  if (jar.get(name)) jar.delete({ name, ...options() });
}

/** Cookie роли под обоими именами (нынешним и прежним). */
function clearRole(jar: Jar, base: CookieBase): void {
  clear(jar, cookieName(base));
  if (cookieName(base) !== base) clear(jar, base);
}

function setRole(jar: Jar, base: CookieBase, value: string, maxAge: number): void {
  if (cookieName(base) !== base) clear(jar, base);
  jar.set(cookieName(base), value, { ...options(), maxAge });
}

/** Сессия менеджера этого браузера: строка в базе и cookie. Удаляется только сессия с токеном из своей cookie. */
async function closeManagerSession(jar: Jar): Promise<void> {
  const token = read(jar, MANAGER);
  if (token) await withManager((tx) => deleteManagerSession(tx, token));
  clearRole(jar, MANAGER);
}

/** Сессия работника в этом браузере: строка в базе и cookie (и старая cookie личной ссылки). */
async function closeWorkerSession(jar: Jar): Promise<void> {
  const token = read(jar, WORKER);
  if (token) await withAnon((tx) => endWorkerSession(tx, token));
  clearRole(jar, WORKER);
  clear(jar, LEGACY_WORKER_TOKEN);
}

/**
 * Вход работника в этом браузере. Одной транзакцией без личности: `open` создаёт сессию работника
 * (личная ссылка, погашение кода или проверенный вход из Mini App) и возвращает её токен, затем
 * закрываются сессия менеджера и прежняя сессия работника этого браузера — сбой любого шага откатывает
 * всё (код остаётся рабочим). Только после неё — cookie: сессия на год, cookie менеджера и старая cookie
 * личной ссылки удаляются. null из `open` — вход не принят, cookie не трогаются.
 */
export async function openWorkerSession<T>(open: (tx: Tx) => Promise<{ session: string | null; result: T }>): Promise<T> {
  const jar = await cookies();
  const manager = read(jar, MANAGER);
  const previous = read(jar, WORKER);
  const { session, result } = await withAnon(async (tx) => {
    const opened = await open(tx);
    if (opened.session === null) return opened;
    if (previous) await endWorkerSession(tx, previous);
    if (manager) await endManagerSessionByToken(tx, manager);
    return opened;
  });
  if (session !== null) {
    clearRole(jar, MANAGER);
    clear(jar, LEGACY_WORKER_TOKEN);
    setRole(jar, WORKER, session, YEAR);
  }
  return result;
}

/**
 * Вход по личной ссылке (POST «Войти» на `/w/<токен>/confirm`, L6): токен ссылки меняется на сессию работника
 * (`personal_link_login`, 0015) — в cookie только токен сессии, сам токен ссылки в браузере не остаётся.
 * Перевыпуск ссылки и архив закрывают и эту сессию. false — ссылка недействительна.
 */
export async function loginWithPersonalLink(token: string): Promise<boolean> {
  if (!token) return false;
  return openWorkerSession(async (tx) => {
    const session = generateToken();
    const ok = await personalLinkLogin(tx, token, session);
    return { session: ok ? session : null, result: ok };
  });
}

/** Вход по коду из бота (POST подтверждения `/tg/[code]`); false — код не принят. */
export async function loginWithCode(code: string): Promise<boolean> {
  if (!isTokenShape(code)) return false;
  return openWorkerSession(async (tx) => {
    const session = await redeemWorkerLoginCode(tx, code);
    return { session, result: session !== null };
  });
}

/**
 * Вход из Mini App по проверенным initData: сессия работника, чей чат — этот пользователь Telegram.
 * `kept` — браузер уже вошёл им через этот чат, cookie не меняются.
 */
export async function loginWithWebApp(auth: WebAppAuth): Promise<WebAppLoginStatus> {
  const current = read(await cookies(), WORKER) ?? null;
  return openWorkerSession(async (tx) => {
    const session = generateToken();
    const status = await webAppLogin(tx, auth, session, current);
    return { session: status === 'ok' ? session : null, result: status };
  });
}

/**
 * Перенос cookie прежних версий (`/auth/upgrade`, переходный период L6/L7):
 * - `manager_session` / `worker_session` без префикса — под имена `__Host-` (на бою), старые удаляются;
 * - `worker_token` (сырой токен личной ссылки) — на сессию работника и удаляется; если сессия уже есть,
 *   просто удаляется. Ссылка больше не действует — `link-invalid` (страница входа скажет об этом).
 * Меняет только cookie этого браузера и только на ту же роль: ни расширить, ни сменить её здесь нельзя.
 */
export async function upgradeLegacyCookies(): Promise<'ok' | 'link-invalid'> {
  const jar = await cookies();
  for (const base of [MANAGER, WORKER]) {
    const legacy = cookieName(base) !== base ? jar.get(base)?.value : undefined;
    if (!legacy) continue;
    if (jar.get(cookieName(base))?.value) clear(jar, base);
    else setRole(jar, base, legacy, base === MANAGER ? MANAGER_SESSION_HOURS * 60 * 60 : YEAR);
  }
  const linkToken = jar.get(LEGACY_WORKER_TOKEN)?.value;
  if (!linkToken) return 'ok';
  const session = read(jar, WORKER);
  // Одна роль на браузер: уже есть менеджер или действующая сессия работника — старая cookie просто уходит.
  if (read(jar, MANAGER) || (session && (await findWorkerBySession(session)))) {
    clear(jar, LEGACY_WORKER_TOKEN);
    return 'ok';
  }
  const switched = await openWorkerSession(async (tx) => {
    const fresh = generateToken();
    const ok = await personalLinkLogin(tx, linkToken, fresh);
    return { session: ok ? fresh : null, result: ok };
  });
  if (switched) return 'ok';
  clear(jar, LEGACY_WORKER_TOKEN);
  return 'link-invalid';
}

/**
 * Какая роль в этом браузере закроется при входе работника `fullName` (подтверждение входа):
 * менеджер, другой работник — его имя, или ничего.
 */
export async function roleToClose(fullName: string): Promise<string | null> {
  if (await isManager()) return 'Вход менеджера в этом браузере закроется.';
  const current = await getCurrentWorker();
  return current && current.fullName !== fullName ? `Кабинет «${current.fullName}» в этом браузере закроется.` : null;
}

/** Браузер уже вошёл работником `workerId` (и не менеджером): личной ссылке подтверждение не нужно. */
export async function isSignedInAs(workerId: string): Promise<boolean> {
  if (await isManager()) return false;
  return (await getCurrentWorker())?.id === workerId;
}

/**
 * Работник этого браузера: сессия работника, а в переходный период — и старая cookie личной ссылки
 * (`worker_token`, до переноса на `/auth/upgrade`). Обёрнуто в React.cache: layout и страница обе зовут
 * getCurrentWorker/requireWorker в рамках одного запроса — без кеша это был бы лишний поход в базу на
 * каждый вызов. Кеш живёт только на время запроса.
 */
export const getCurrentWorker = cache(async (): Promise<CurrentWorker | null> => {
  const jar = await cookies();
  const session = read(jar, WORKER);
  if (session) {
    const worker = await findWorkerBySession(session);
    if (worker) return worker;
  }
  const token = jar.get(LEGACY_WORKER_TOKEN)?.value;
  return token ? findWorkerByToken(token) : null;
});

/** Токен сессии работника этого браузера — только чтобы не закрыть свою же сессию. */
export async function workerSessionToken(): Promise<string | null> {
  return read(await cookies(), WORKER) ?? null;
}

/**
 * Нет cookie — на экран «Это кабинет работника». Cookie есть, но больше не действует
 * (ссылку перевыпустили, работника убрали в архив) — туда же с плашкой «ссылка недействительна»,
 * чтобы человек понял, что просить новую.
 */
export async function requireWorker(): Promise<CurrentWorker> {
  const worker = await getCurrentWorker();
  if (worker) return worker;
  const jar = await cookies();
  const hadCookie = Boolean(read(jar, WORKER) || jar.get(LEGACY_WORKER_TOKEN)?.value);
  redirect(hadCookie ? '/login?for=worker&error=link' : '/login?for=worker');
}

export async function isManager(): Promise<boolean> {
  const token = read(await cookies(), MANAGER);
  if (!token) return false;
  return withAnon((tx) => isManagerSessionValid(tx, token));
}

export async function requireManager(): Promise<void> {
  if (!(await isManager())) redirect('/login');
}

/**
 * Вызывать только после проверки пароля. Кабинет работника в этом браузере закрывается
 * (cookie и сессия — и в базе): роли не смешиваются.
 */
export async function startManagerSession(): Promise<void> {
  const token = await withManager((tx) => createManagerSession(tx));
  const jar = await cookies();
  await closeWorkerSession(jar);
  setRole(jar, MANAGER, token, MANAGER_SESSION_HOURS * 60 * 60);
}

export async function endManagerSession(): Promise<void> {
  await closeManagerSession(await cookies());
}
