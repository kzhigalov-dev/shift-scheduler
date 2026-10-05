import type { Tx } from '@/db/client';
import type { JsonObject, TelegramApi } from './api';

/** Запуск операции в своей короткой транзакции (`withManager` / `asManager` в тестах). */
export type Db = <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;

export const MAX_ATTEMPTS = 5;
/** Сколько взятое в работу сообщение скрыто от других тиков: хватает на всю отправку пачки. */
export const LEASE_MINUTES = 5;
/** Время на отправку за один тик (маршрут живёт 60 с, запрос к Telegram — до 10 с). */
export const DELIVER_BUDGET_MS = 40_000;
/** 429 без retry_after — подождать столько секунд. */
export const DEFAULT_RETRY_AFTER_S = 30;

type OutboxRow = { id: string; chat_id: string; text: string; reply_markup: JsonObject | null };

/** Взять пачку в работу: коротко, в своей транзакции, с арендой через `send_after`. */
async function claim(db: Db, limit: number): Promise<OutboxRow[]> {
  const rows = await db((tx) => tx<OutboxRow[]>`
    update tg_outbox set send_after = now() + make_interval(mins => ${LEASE_MINUTES})
    where id in (
      select id from tg_outbox
      where sent_at is null and send_after <= now() and attempts < ${MAX_ATTEMPTS}
      order by id limit ${limit} for update skip locked)
    returning id, chat_id, text, reply_markup`);
  return [...rows].sort((a, b) => Number(a.id) - Number(b.id));
}

/** Вернуть неотправленный остаток пачки в очередь через `delaySeconds`. */
async function release(db: Db, rows: OutboxRow[], delaySeconds: number): Promise<void> {
  if (rows.length === 0) return;
  await db((tx) => tx`update tg_outbox set send_after = now() + make_interval(secs => ${delaySeconds})
    where id in ${tx(rows.map((r) => r.id))} and sent_at is null`);
}

/**
 * Отправить готовые сообщения очереди. Каждая отправка записывается сразу в своей
 * транзакции, поэтому откат чего-либо после неё не приводит к повторной отправке.
 * 403 (бот заблокирован) — больше не пытаться; 429 — подождать `retry_after`, попытку
 * не считать и остановить пачку; прочие ошибки — попытка + 1 и отсрочка 2^n минут.
 */
export async function deliverDue(
  db: Db, api: TelegramApi, opts: { limit: number; budgetMs?: number },
): Promise<{ sent: number; failed: number }> {
  const deadline = Date.now() + (opts.budgetMs ?? DELIVER_BUDGET_MS);
  const rows = await claim(db, opts.limit);
  let sent = 0;
  let failed = 0;
  for (let i = 0; i < rows.length; i += 1) {
    if (Date.now() >= deadline) {
      await release(db, rows.slice(i), 0);
      break;
    }
    const r = rows[i];
    const res = await api.sendMessage(Number(r.chat_id), r.text, r.reply_markup ?? undefined);
    if (res.ok) {
      sent += 1;
      await db((tx) => tx`update tg_outbox set sent_at = now(), last_error = null where id = ${r.id}`);
      continue;
    }
    failed += 1;
    const error = `${res.status} ${res.description}`.slice(0, 300);
    if (res.status === 429) {
      const wait = Math.max(1, Math.ceil(res.retryAfter ?? DEFAULT_RETRY_AFTER_S));
      await db((tx) => tx`update tg_outbox set send_after = now() + make_interval(secs => ${wait}), last_error = ${error}
        where id = ${r.id}`);
      await release(db, rows.slice(i + 1), wait);
      break;
    }
    if (res.status === 403) {
      await db((tx) => tx`update tg_outbox set attempts = ${MAX_ATTEMPTS}, last_error = ${error} where id = ${r.id}`);
    } else {
      // Справа в set — старое значение attempts: после первой ошибки 1 минута, затем 2, 4, 8.
      await db((tx) => tx`update tg_outbox set attempts = attempts + 1, last_error = ${error},
        send_after = now() + make_interval(mins => power(2, attempts)::int) where id = ${r.id}`);
    }
  }
  return { sent, failed };
}
