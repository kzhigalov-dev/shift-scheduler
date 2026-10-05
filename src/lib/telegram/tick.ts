import { createHash } from 'node:crypto';
import type { Tx } from '@/db/client';
import type { TelegramApi } from './api';
import { DELIVER_BUDGET_MS, deliverDue, MAX_ATTEMPTS, type Db } from './delivery';
import { beforeReminderText, eveningReminderText, LOGIN_ATTACK_TEXT, understaffedText, type ShiftInfo } from './messages';
import { loginUnderAttack } from '@/lib/auth/loginThrottle';
import { shiftKeyboard, understaffedKeyboard, withLoginButton } from './keyboards';
import { ensureCommands } from './menu';
import { parseManagerPrefs, parseWorkerPrefs, type RawPrefs } from './prefs';
import { addDays, insertMessages, loadLinks, processEvents, understaffedItems, UNDERSTAFFED_DAYS } from './process';
import { dueReminders, moscowNow } from './reminders';

export const UNDERSTAFFED_HOUR = '12';
/** Сколько дней хранить обработанный журнал и отправленные сообщения. */
export const KEEP_DAYS = 30;
/** Маршрут живёт 60 с (`maxDuration`): на весь тик — 45 с, остальное — на одну неоконченную отправку. */
export const TICK_BUDGET_MS = 45_000;

/** Что осталось на отправку после вебхука, меню и очереди: не больше `DELIVER_BUDGET_MS`, не меньше нуля. */
export const deliverBudgetMs = (startedAt: number): number =>
  Math.max(0, Math.min(DELIVER_BUDGET_MS, startedAt + TICK_BUDGET_MS - Date.now()));

/** Неотправленное старше этого не отправляется вовсе (например, ключ бота появился позже). */
export const STALE_HOURS = 24;
export const DELIVER_LIMIT = 100;

type ReminderSource = ShiftInfo & {
  event_id: string; worker_id: string; chat_id: string; prefs: RawPrefs; cancel_requested: boolean;
};

/** Напоминания накануне и перед приходом; повтор гасит ключ `reminder:<kind>:<event>:<worker>`. */
export async function enqueueReminders(tx: Tx, now: Date, origin: string): Promise<void> {
  const today = moscowNow(now).date;
  const rows = await tx<ReminderSource[]>`
    select a.event_id, a.worker_id, l.chat_id, l.prefs, a.cancel_requested_at is not null as cancel_requested,
      to_char(e.event_date, 'YYYY-MM-DD') as date, to_char(e.start_time, 'HH24:MI') as start,
      to_char(e.arrive_time, 'HH24:MI') as arrive, e.concert, p.name as position
    from assignment a
    join event e on e.id = a.event_id
    join telegram_link l on l.worker_id = a.worker_id
    join worker w on w.id = a.worker_id and w.status = 'active'
    left join position p on p.id = a.position_id
    where e.event_date in (${today}::date, ${addDays(today, 1)}::date)
      and exists (select 1 from month m where m.month = to_char(e.event_date, 'YYYY-MM') and m.status = 'published')`;
  const due = dueReminders(now, rows.map((r) => ({
    eventId: r.event_id, workerId: r.worker_id, date: r.date, start: r.start, arrive: r.arrive, prefs: parseWorkerPrefs(r.prefs),
  })));
  await insertMessages(tx, due.flatMap((d) => {
    const r = rows.find((x) => x.event_id === d.eventId && x.worker_id === d.workerId);
    if (!r) return [];
    const text = d.kind === 'reminder_evening' ? eveningReminderText(r) : beforeReminderText(r, d.hours ?? 0);
    return [{
      chatId: Number(r.chat_id), text, key: `reminder:${d.kind}:${d.eventId}:${d.workerId}`,
      // Отмена уже запрошена — «Не смогу» не предлагаем.
      replyMarkup: withLoginButton(r.cancel_requested ? null : shiftKeyboard(r.event_id, r.date, today), origin, '/shifts'),
    }];
  }));
}

/** В 12:00 по Москве — менеджеру список мероприятий ближайших 3 дней со свободными местами (раз в день). */
export async function enqueueUnderstaffed(tx: Tx, now: Date, origin: string): Promise<void> {
  const m = moscowNow(now);
  if (m.time.slice(0, 2) !== UNDERSTAFFED_HOUR) return;
  const manager = (await loadLinks(tx)).find((l) => l.workerId === null);
  if (!manager || !parseManagerPrefs(manager.prefs).understaffed) return;
  const items = await understaffedItems(tx, m.date, UNDERSTAFFED_DAYS);
  if (items.length === 0) return;
  await insertMessages(tx, [{
    chatId: manager.chatId, text: understaffedText(items), key: `understaffed:${m.date}`, replyMarkup: understaffedKeyboard(items, origin),
  }]);
}

/**
 * Перебор пароля менеджера (L3) — предупреждение в чат менеджера, не чаще раза в час (ключ — московский час).
 * Без настроек: это безопасность, а не уведомление о сменах.
 */
export async function enqueueLoginAlert(tx: Tx, now: Date): Promise<void> {
  if (!(await loginUnderAttack(tx))) return;
  const manager = (await loadLinks(tx)).find((l) => l.workerId === null);
  if (!manager) return;
  const m = moscowNow(now);
  await insertMessages(tx, [{ chatId: manager.chatId, text: LOGIN_ATTACK_TEXT, key: `login-attack:${m.date}T${m.time.slice(0, 2)}` }]);
}

/** Отпечаток адреса и секрета вебхука: при смене любого из них — регистрация заново. */
export const webhookFingerprint = (url: string, secret: string): string =>
  createHash('sha256').update(`${url}|${secret}`).digest('hex');

/**
 * Регистрирует вебхук, если адрес или секрет изменились (отпечаток — в `app_state('webhook')`).
 * Запрос к Telegram — вне транзакции; отпечаток пишется только после успеха.
 */
export async function ensureWebhook(db: Db, api: TelegramApi, origin: string, secret: string): Promise<void> {
  const url = `${origin}/api/telegram/webhook`;
  const fingerprint = webhookFingerprint(url, secret);
  const [row] = await db((tx) => tx<Array<{ value: string }>>`select value from app_state where name = 'webhook'`);
  if (row?.value === fingerprint) return;
  const res = await api.setWebhook(url, secret);
  if (!res.ok) return;
  await db((tx) => tx`insert into app_state (name, value) values ('webhook', ${fingerprint})
    on conflict (name) do update set value = excluded.value`);
}

/**
 * Необработанный журнал старше STALE_HOURS не превращается в сообщения (они устарели, как и неотправленное
 * в очереди) — строки помечаются обработанными и уходят уборкой через KEEP_DAYS. Журнал не растёт без предела,
 * даже если поток уведомлений когда-то обгонял тик (M3 ревью безопасности).
 */
async function dropStaleEvents(tx: Tx): Promise<void> {
  await tx`update tg_event set processed_at = now()
    where processed_at is null and created_at < now() - make_interval(hours => ${STALE_HOURS})`;
}

/**
 * Уборка по часам базы: обработанный журнал и отправленные (или брошенные) сообщения
 * старше KEEP_DAYS дней; неотправленное старше STALE_HOURS — бросить, чтобы не было лавины.
 */
async function housekeeping(tx: Tx): Promise<void> {
  await tx`delete from tg_event where processed_at < now() - make_interval(days => ${KEEP_DAYS})`;
  await tx`delete from tg_outbox where sent_at < now() - make_interval(days => ${KEEP_DAYS})
    or (sent_at is null and attempts >= ${MAX_ATTEMPTS} and created_at < now() - make_interval(days => ${KEEP_DAYS}))`;
  await tx`update tg_outbox set attempts = ${MAX_ATTEMPTS}, last_error = 'expired'
    where sent_at is null and attempts < ${MAX_ATTEMPTS} and created_at < now() - make_interval(hours => ${STALE_HOURS})`;
}

/**
 * Тик раз в минуту. Фазы — в своих транзакциях (`db` = `withManager`):
 * 1) вебхук и меню команд (запросы к Telegram вне транзакции); 2) напоминания, нехватка, журнал → очередь,
 * уборка — одна транзакция; 3) отправка — короткие транзакции на взятие пачки и на каждое
 * сообщение. Без ключа бота (`api = null`) события обрабатываются, сообщения копятся.
 * `now` — только для московских даты и часа.
 */
export async function runTick(opts: {
  now: Date; origin: string; api: TelegramApi | null; secret: string | null; db: Db;
}): Promise<{ processed: number; sent: number; failed: number }> {
  const { now, origin, api, secret, db } = opts;
  const startedAt = Date.now();
  if (api && secret) {
    await ensureWebhook(db, api, origin, secret);
    await ensureCommands(db, api, secret);
  }
  const processed = await db(async (tx) => {
    await enqueueReminders(tx, now, origin);
    await enqueueUnderstaffed(tx, now, origin);
    await enqueueLoginAlert(tx, now);
    await dropStaleEvents(tx);
    const n = await processEvents(tx, now, origin);
    await housekeeping(tx);
    return n;
  });
  const { sent, failed } = api ? await deliverDue(db, api, { limit: DELIVER_LIMIT, budgetMs: deliverBudgetMs(startedAt) }) : { sent: 0, failed: 0 };
  return { processed, sent, failed };
}
