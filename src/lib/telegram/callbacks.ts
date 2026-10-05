import { isMonth } from '@/lib/month';
import { loginTarget } from '@/lib/auth/loginTarget';

/**
 * Данные кнопок бота: `<op>:<id>[:<id>]`, id — uuid в base64url (16 байт → 22 символа);
 * «Заработок» за месяц — `pm:YYYY-MM`; «Открыть приложение» — `lo[:a|e|n[:YYYY-MM]]`. Не длиннее 64 байт.
 * Прежние форматы не меняются: кнопки уже отправленных сообщений продолжают работать.
 */
export type EventCallback = { op: 'su' | 'sw' | 'cx' | 'cy' | 'cb'; eventId: string };
/** «‹ август» / «октябрь ›» под ответом «Заработок». */
export type PayCallback = { op: 'pm'; month: string };
/** «Открыть приложение»: ссылка для входа; `to` — путь после входа (только из белого списка `loginTarget`). */
export type LoginCallback = { op: 'lo'; to: string };
export type WorkerCallback = EventCallback | PayCallback | LoginCallback;
export type ManagerCallback =
  | { op: 'ma'; signupId: string; positionId: string | null }
  | { op: 'mr'; signupId: string }
  | { op: 'mo' | 'mk'; eventId: string; workerId: string };
export type Callback = WorkerCallback | ManagerCallback;

const MAX_DATA_BYTES = 64;
const PACKED = /^[A-Za-z0-9_-]{22}$/;
const WORKER_OPS: ReadonlySet<string> = new Set(['su', 'sw', 'cx', 'cy', 'cb', 'pm', 'lo']);
/** Страница после входа ⇄ буква в данных кнопки; `/shifts` — просто `lo`. */
const LOGIN_PAGE_KEYS: ReadonlyArray<readonly [string, string]> = [['/available', 'a'], ['/earnings', 'e'], ['/notifications', 'n']];

function encodeLogin(to: string): string {
  const [page, query] = loginTarget(to).split('?month=');
  const key = LOGIN_PAGE_KEYS.find(([p]) => p === page)?.[1];
  if (!key) return 'lo';
  return query ? `lo:${key}:${query}` : `lo:${key}`;
}

function parseLogin(raw: string[]): LoginCallback | null {
  if (raw.length === 0) return { op: 'lo', to: '/shifts' };
  const page = LOGIN_PAGE_KEYS.find(([, k]) => k === raw[0])?.[0];
  if (!page || raw.length > 2) return null;
  if (raw.length === 1) return { op: 'lo', to: page };
  return page === '/earnings' && isMonth(raw[1]) ? { op: 'lo', to: `/earnings?month=${raw[1]}` } : null;
}

export const isWorkerCallback = (c: Callback): c is WorkerCallback => WORKER_OPS.has(c.op);

export function packId(uuid: string): string {
  return Buffer.from(uuid.replace(/-/g, ''), 'hex').toString('base64url');
}

/** 22 символа → uuid; неканоническая запись (лишние биты в последнем символе) не принимается. */
export function unpackId(s: string): string | null {
  if (!PACKED.test(s)) return null;
  const bytes = Buffer.from(s, 'base64url');
  if (bytes.length !== 16 || bytes.toString('base64url') !== s) return null;
  const h = bytes.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function encodeCallback(c: Callback): string {
  switch (c.op) {
    case 'ma':
      return c.positionId === null ? `ma:${packId(c.signupId)}` : `ma:${packId(c.signupId)}:${packId(c.positionId)}`;
    case 'mr':
      return `mr:${packId(c.signupId)}`;
    case 'mo':
    case 'mk':
      return `${c.op}:${packId(c.eventId)}:${packId(c.workerId)}`;
    case 'pm':
      return `pm:${c.month}`;
    case 'lo':
      return encodeLogin(c.to);
    default:
      return `${c.op}:${packId(c.eventId)}`;
  }
}

/** Разбор нажатия: неизвестная операция, не то число id, id не 16 байт или неверный месяц — null. */
export function parseCallback(data: string): Callback | null {
  if (Buffer.byteLength(data) > MAX_DATA_BYTES) return null;
  const [op, ...raw] = data.split(':');
  if (op === 'pm') return raw.length === 1 && isMonth(raw[0]) ? { op, month: raw[0] } : null;
  if (op === 'lo') return parseLogin(raw);
  const ids = raw.map(unpackId).filter((id): id is string => id !== null);
  if (ids.length === 0 || ids.length !== raw.length) return null;
  const [a, b] = ids;
  switch (op) {
    case 'su':
    case 'sw':
    case 'cx':
    case 'cy':
    case 'cb':
      return ids.length === 1 ? { op, eventId: a } : null;
    case 'ma':
      return ids.length <= 2 ? { op, signupId: a, positionId: b ?? null } : null;
    case 'mr':
      return ids.length === 1 ? { op, signupId: a } : null;
    case 'mo':
    case 'mk':
      return ids.length === 2 ? { op, eventId: a, workerId: b } : null;
    default:
      return null;
  }
}
