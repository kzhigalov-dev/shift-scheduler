import type { Tx } from '@/db/client';
import { addDays, monthRange } from '@/lib/month';
import type { RateRange } from '@/lib/pay/calculatePay';
import { eventRateRanges } from '@/lib/pay/eventRates';
import * as msg from './messages';
import type { ShiftInfo } from './messages';
import { parseManagerPrefs, parseWorkerPrefs, WORKER_KIND_PREF, type RawPrefs } from './prefs';
import { managerCancelKeyboard, shiftKeyboard, signupButton, withAppLink, withLoginButton, type Keyboard } from './keyboards';
import { signupRequestMarkup } from './markup';
import { moscowNow } from './reminders';

/** Снимок мероприятия, который пишут триггеры 0007 (`tg_event_snapshot`). */
type Snapshot = { date?: string; start?: string; arrive?: string | null; concert?: string | null };
/** `created` — время транзакции, записавшей строку (`now()` в `tg_event.created_at`), текстом без потери точности. */
type EventRow = { id: string; kind: string; worker_id: string | null; event_id: string | null; month: string | null; payload: Snapshot; draft_era: boolean; created: string };
export type Link = { workerId: string | null; chatId: number; prefs: RawPrefs };
/** `marker` — только ключ в очереди (сразу отправленным): учёт «раз в 6 часов» для мероприятия из сводки. */
export type Message = { chatId: number; text: string; key: string; replyMarkup?: Keyboard | null; marker?: boolean };

type WorkerEventKind = 'assigned' | 'removed' | 'cancel_approved' | 'kept' | 'event_cancelled' | 'rejected' | 'time_changed';
const WORKER_TEXT: Record<WorkerEventKind, (s: ShiftInfo) => string> = {
  assigned: msg.assignedText,
  removed: msg.removedText,
  cancel_approved: msg.cancelApprovedText,
  kept: msg.keptText,
  event_cancelled: msg.eventCancelledText,
  rejected: msg.rejectedText,
  time_changed: msg.timeChangedText,
};
/** Виды со снимком в `payload`: мероприятия или назначения к обработке уже может не быть. */
const SNAPSHOT_KINDS = new Set<string>(['removed', 'cancel_approved', 'event_cancelled']);
/** Виды, которые имеют смысл, только пока работник стоит на мероприятии. */
const NEEDS_ASSIGNMENT = new Set<string>(['time_changed', 'kept']);
const isWorkerKind = (kind: string): kind is WorkerEventKind => kind in WORKER_TEXT;

export const FREE_PLACE_DAYS = 7;
export const FREE_PLACE_EVERY_HOURS = 6;

export { addDays };

/** Подключённые чаты: работники — только действующие; строка с `workerId = null` — менеджер. */
export async function loadLinks(tx: Tx): Promise<Link[]> {
  const rows = await tx<Array<{ worker_id: string | null; chat_id: string; prefs: RawPrefs }>>`
    select l.worker_id, l.chat_id, l.prefs from telegram_link l
    left join worker w on w.id = l.worker_id
    where l.worker_id is null or w.status = 'active'`;
  return rows.map((r) => ({ workerId: r.worker_id, chatId: Number(r.chat_id), prefs: r.prefs }));
}

/** В очередь; `send_after` и `created_at` — по часам базы. Повтор ключа — без вставки. */
export async function insertMessages(tx: Tx, messages: Message[]): Promise<void> {
  for (const m of messages) {
    const markup = m.replyMarkup ? tx.json(m.replyMarkup) : null;
    await tx`insert into tg_outbox (chat_id, text, reply_markup, dedupe_key, sent_at)
      values (${m.chatId}, ${msg.clipText(m.text)}, ${markup}, ${m.key}, ${m.marker ? tx`now()` : tx`null`})
      on conflict (dedupe_key) do nothing`;
  }
}

async function monthPublished(tx: Tx, month: string): Promise<boolean> {
  const [row] = await tx<Array<{ published: boolean }>>`
    select exists (select 1 from month where month = ${month} and status = 'published') as published`;
  return row.published;
}

type EventInfo = ShiftInfo & { name: string | null; published: boolean; assigned: boolean };

/** Мероприятие с должностью работника на нём (null — не расставлен или уже снят). */
async function eventInfo(tx: Tx, eventId: string, workerId: string): Promise<EventInfo | null> {
  const [row] = await tx<EventInfo[]>`
    select to_char(e.event_date, 'YYYY-MM-DD') as date, to_char(e.start_time, 'HH24:MI') as start,
      to_char(e.arrive_time, 'HH24:MI') as arrive, e.concert, p.name as position, w.full_name as name,
      exists (select 1 from month m where m.month = to_char(e.event_date, 'YYYY-MM') and m.status = 'published') as published,
      a.id is not null as assigned
    from event e
    left join assignment a on a.event_id = e.id and a.worker_id = ${workerId}
    left join position p on p.id = a.position_id
    left join worker w on w.id = ${workerId}
    where e.id = ${eventId}`;
  return row ?? null;
}

async function workerMessages(tx: Tx, row: EventRow, kind: WorkerEventKind, links: Link[], today: string, origin: string): Promise<Message[]> {
  if (!row.worker_id || !row.event_id) return [];
  const link = links.find((l) => l.workerId === row.worker_id);
  if (!link || !parseWorkerPrefs(link.prefs)[WORKER_KIND_PREF[kind]]) return [];
  let shift: ShiftInfo;
  if (SNAPSHOT_KINDS.has(kind)) {
    const s = row.payload;
    if (!s.date || !s.start) return [];
    if (!(await monthPublished(tx, s.date.slice(0, 7)))) return [];
    shift = { date: s.date, start: s.start, arrive: s.arrive ?? null, concert: s.concert ?? null, position: null };
  } else {
    const info = await eventInfo(tx, row.event_id, row.worker_id);
    if (!info || !info.published || (NEEDS_ASSIGNMENT.has(kind) && !info.assigned)) return [];
    shift = info;
  }
  if (shift.date < today) return [];
  const actions = kind === 'assigned' ? shiftKeyboard(row.event_id, shift.date, today) : null;
  const replyMarkup = withLoginButton(actions, origin, kind === 'rejected' ? '/available' : '/shifts');
  return [{ chatId: link.chatId, text: WORKER_TEXT[kind](shift), key: `ev:${row.id}:${link.chatId}`, replyMarkup }];
}

/** О заявке одного работника на одно мероприятие менеджеру — не чаще раза в час (M3 ревью безопасности). */
export const SIGNUP_NOTICE_EVERY_HOURS = 1;

/** Ключ очереди уведомления о заявке: по нему видно, писали ли менеджеру об этой паре недавно. */
const signupKey = (workerId: string, eventId: string) => `signup:${workerId}:${eventId}:`;

async function signupNotifiedRecently(tx: Tx, workerId: string, eventId: string): Promise<boolean> {
  const [row] = await tx<Array<{ recent: boolean }>>`
    select exists (select 1 from tg_outbox where dedupe_key like ${`${signupKey(workerId, eventId)}%`}
      and created_at > now() - make_interval(hours => ${SIGNUP_NOTICE_EVERY_HOURS})) as recent`;
  return row.recent;
}

/**
 * Заявка — только пока она ещё ждёт решения (отозванную или уже рассмотренную не присылаем) и не чаще раза
 * в SIGNUP_NOTICE_EVERY_HOURS на пару «работник — мероприятие»: круг «заявка → отзыв → заявка» не засыпает
 * менеджера сообщениями. Повторную заявку он видит в приложении.
 */
async function managerMessages(tx: Tx, row: EventRow, kind: 'm_signup' | 'm_cancel', links: Link[], today: string, origin: string): Promise<Message[]> {
  if (!row.worker_id || !row.event_id) return [];
  const link = links.find((l) => l.workerId === null);
  const prefs = link ? parseManagerPrefs(link.prefs) : null;
  if (!link || !prefs || !(kind === 'm_signup' ? prefs.signups : prefs.cancels)) return [];
  const info = await eventInfo(tx, row.event_id, row.worker_id);
  if (!info || !info.published || info.date < today) return [];
  const data = { name: info.name ?? '', date: info.date, concert: info.concert };
  if (kind === 'm_cancel') {
    const replyMarkup = withAppLink(managerCancelKeyboard(row.event_id, row.worker_id), origin, `/event/${row.event_id}`);
    return [{ chatId: link.chatId, text: msg.managerCancelText(data), key: `ev:${row.id}:${link.chatId}`, replyMarkup }];
  }
  const actions = await signupRequestMarkup(tx, row.event_id, row.worker_id);
  if (!actions || await signupNotifiedRecently(tx, row.worker_id, row.event_id)) return [];
  const replyMarkup = withAppLink(actions, origin, `/event/${row.event_id}`);
  return [{
    chatId: link.chatId, text: msg.managerSignupText(data),
    key: `${signupKey(row.worker_id, row.event_id)}${row.id}:${link.chatId}`, replyMarkup,
  }];
}

async function publishedMessages(tx: Tx, row: EventRow, links: Link[], today: string, origin: string): Promise<Message[]> {
  if (!row.month || !(await monthPublished(tx, row.month))) return [];
  const { from, to } = monthRange(row.month);
  if (to <= today) return [];
  const shifts = await tx<Array<{ worker_id: string; n: number }>>`
    select a.worker_id, count(*)::int as n from assignment a join event e on e.id = a.event_id
    where e.event_date >= ${from}::date and e.event_date < ${to}::date group by a.worker_id`;
  const [{ free }] = await tx<Array<{ free: number }>>`
    select coalesce(sum(greatest(0, x.places - x.taken)), 0)::int as free from (
      select (select coalesce(sum(s.quantity), 0) from event_slot s where s.event_id = e.id) as places,
             (select count(*) from assignment a where a.event_id = e.id) as taken
      from event e where e.event_date >= ${from}::date and e.event_date < ${to}::date and e.event_date >= ${today}::date
    ) x`;
  const month = row.month;
  return links
    .filter((l) => l.workerId !== null && parseWorkerPrefs(l.prefs).published)
    .map((l) => ({
      chatId: l.chatId,
      text: msg.publishedText({ month, shifts: shifts.find((s) => s.worker_id === l.workerId)?.n ?? 0, free }),
      key: `ev:${row.id}:${l.chatId}`,
      replyMarkup: withLoginButton(null, origin, '/shifts'),
    }));
}

type FreePlace = {
  row: EventRow; eventId: string; date: string; start: string; concert: string | null; free: number;
  rate: RateRange | null; taken: Set<string>; recent: Set<number>;
};

/**
 * Свободное место: мероприятие опубликовано, от сегодня до +7 дней, места есть. Иначе null.
 * `taken` — работники на мероприятии; `recent` — чаты, которым о нём уже писали за 6 часов
 * (по ключам `free:<eventId>:…` очереди и её `created_at` — часы базы).
 */
async function freePlace(tx: Tx, row: EventRow, eventId: string, today: string): Promise<FreePlace | null> {
  const [e] = await tx<Array<{ date: string; start: string; concert: string | null; free: number; published: boolean }>>`
    select to_char(e.event_date, 'YYYY-MM-DD') as date, to_char(e.start_time, 'HH24:MI') as start, e.concert,
      ((select coalesce(sum(s.quantity), 0) from event_slot s where s.event_id = e.id)
        - (select count(*) from assignment a where a.event_id = e.id))::int as free,
      exists (select 1 from month m where m.month = to_char(e.event_date, 'YYYY-MM') and m.status = 'published') as published
    from event e where e.id = ${eventId}`;
  if (!e || !e.published || e.free <= 0 || e.date < today || e.date > addDays(today, FREE_PLACE_DAYS)) return null;
  const taken = new Set((await tx<Array<{ worker_id: string }>>`
    select worker_id from assignment where event_id = ${eventId}`).map((r) => r.worker_id));
  const recent = new Set((await tx<Array<{ chat_id: string }>>`
    select chat_id from tg_outbox where dedupe_key like ${`free:${eventId}:%`}
      and created_at > now() - make_interval(hours => ${FREE_PLACE_EVERY_HOURS})`).map((r) => Number(r.chat_id)));
  const rate = (await eventRateRanges(tx, [eventId])).get(eventId) ?? null;
  return { row, eventId, date: e.date, start: e.start, concert: e.concert, free: e.free, rate, taken, recent };
}

/**
 * Свободные места: получатели — подключённые работники не на мероприятии, не чаще раза в 6 часов
 * на мероприятие и чат. Строки одной транзакции (одинаковый `created_at`, например применение шаблона
 * вида) — одна сводка «Нужны люди» на чат; если чату из неё подходит одно мероприятие — обычное
 * «Нужен человек» с кнопкой. За каждое мероприятие сводки в очередь ложится ключ-отметка
 * `free:<eventId>:…` (уже отправленная строка), чтобы правило 6 часов действовало и для них.
 * Параллельные тики по одним мероприятиям выстраивают рекомендательные блокировки до конца
 * транзакции — по порядку id, без взаимоблокировки.
 */
async function freePlaceMessages(tx: Tx, rows: EventRow[], links: Link[], today: string, origin: string): Promise<Message[]> {
  const ids = [...new Set(rows.map((r) => r.event_id).filter((id): id is string => id !== null))].sort();
  for (const id of ids) await tx`select pg_advisory_xact_lock(hashtext(${`tg_free:${id}`}))`;
  const batches = new Map<string, FreePlace[]>();
  for (const r of rows) {
    const place = r.event_id ? await freePlace(tx, r, r.event_id, today) : null;
    if (place) batches.set(r.created, [...(batches.get(r.created) ?? []), place]);
  }
  const workers = links.filter((l) => l.workerId !== null && parseWorkerPrefs(l.prefs).free);
  const messages: Message[] = [];
  for (const batch of batches.values()) {
    batch.sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
    for (const l of workers) {
      const places = batch.filter((p) => !p.taken.has(l.workerId ?? '') && !p.recent.has(l.chatId));
      if (places.length === 1) {
        const [p] = places;
        messages.push({
          chatId: l.chatId, text: msg.freePlaceText(p), key: `free:${p.eventId}:${p.row.id}:${l.chatId}`,
          replyMarkup: withLoginButton({ inline_keyboard: [[signupButton(p.eventId)]] }, origin, '/available'),
        });
      } else if (places.length > 1) {
        const digest = `free-digest:${places[0].row.id}:${l.chatId}`;
        messages.push({ chatId: l.chatId, text: msg.freePlacesText(places), key: digest, replyMarkup: withLoginButton(null, origin, '/available') });
        for (const p of places) messages.push({ chatId: l.chatId, text: digest, key: `free:${p.eventId}:${p.row.id}:${l.chatId}`, marker: true });
      }
    }
  }
  return messages;
}

/** Ключ слияния строк в пачке: повторы одного вида по тому же работнику и мероприятию — одно сообщение. */
function groupKey(r: EventRow): string {
  if (r.kind === 'published') return `published:${r.month}`;
  if (r.kind === 'free_place') return `free:${r.event_id}`;
  return `${r.kind}:${r.worker_id}:${r.event_id}`;
}

/**
 * Повторы одного уведомления (тот же вид, работник, мероприятие, месяц) в журнале сливаются до выборки:
 * остаётся самая свежая строка, прежние сразу помечаются обработанными. Поток повторов от одного работника
 * не занимает пачку и не задерживает уведомления остальных. Строки, взятые параллельным тиком, пропускаются.
 */
async function collapseDuplicates(tx: Tx): Promise<number> {
  const rows = await tx`
    update tg_event set processed_at = now() where id in (
      select t.id from tg_event t
      where t.processed_at is null and t.id in (
        select x.id from (
          select id, row_number() over (partition by kind, worker_id, event_id, month order by id desc) as n
          from tg_event where processed_at is null
        ) x where x.n > 1)
      for update of t skip locked)
    returning id`;
  return rows.length;
}

/**
 * Журнал `tg_event` → очередь `tg_outbox`. Черновые (в том числе записанные до публикации месяца) и прошедшие мероприятия,
 * неподключённые получатели и выключенные настройки — без сообщения, но строка
 * всё равно помечается обработанной. Сначала повторы сливаются (`collapseDuplicates`), затем — не больше `limit`
 * разных уведомлений, старые первыми. Возвращает число обработанных строк (с слитыми повторами).
 * `now` — только для московской даты «сегодня»; время очереди — по часам базы.
 */
export async function processEvents(tx: Tx, now: Date, origin: string, limit = 200): Promise<number> {
  const collapsed = await collapseDuplicates(tx);
  // draft_era: событие записано, пока месяц был черновиком (создано строго раньше published_at).
  // Сводка published не в счёт; published_at is null (старые записи) — не фильтруем.
  const rows = await tx<EventRow[]>`
    select t.id, t.kind, t.worker_id, t.event_id, t.month, t.payload, t.created_at::text as created,
      (t.kind <> 'published' and exists (
        select 1 from month m
        where m.month = coalesce(left(t.payload->>'date', 7), (select to_char(e.event_date, 'YYYY-MM') from event e where e.id = t.event_id))
          and m.published_at is not null and t.created_at < m.published_at)) as draft_era
    from tg_event t
    where t.processed_at is null order by t.id limit ${limit} for update of t skip locked`;
  if (rows.length === 0) return collapsed;

  // Последняя строка группы: у неё самые свежие снимок и ключ.
  const groups = new Map<string, EventRow>();
  for (const r of rows) {
    if (r.draft_era) continue; // черновая эпоха: работники узнают из сводки о публикации
    const key = groupKey(r);
    groups.delete(key);
    groups.set(key, r);
  }

  const links = await loadLinks(tx);
  const today = moscowNow(now).date;
  const messages: Message[] = [];
  const free: EventRow[] = [];
  for (const r of groups.values()) {
    if (isWorkerKind(r.kind)) messages.push(...(await workerMessages(tx, r, r.kind, links, today, origin)));
    else if (r.kind === 'm_signup' || r.kind === 'm_cancel') messages.push(...(await managerMessages(tx, r, r.kind, links, today, origin)));
    else if (r.kind === 'published') messages.push(...(await publishedMessages(tx, r, links, today, origin)));
    else if (r.kind === 'free_place' && r.event_id) free.push(r);
  }
  messages.push(...(await freePlaceMessages(tx, free, links, today, origin)));
  await insertMessages(tx, messages);
  await tx`update tg_event set processed_at = now() where id in ${tx(rows.map((r) => r.id))}`;
  return collapsed + rows.length;
}

/** Сколько дней вперёд смотрит «нехватка людей» (тик в 12:00 и `/understaffed`). */
export const UNDERSTAFFED_DAYS = 3;

export type UnderstaffedItem = { eventId: string; date: string; start: string; concert: string | null; free: number };

/** Опубликованные мероприятия с `today` по `today + days` со свободными местами — по дате и времени. */
export async function understaffedItems(tx: Tx, today: string, days: number): Promise<UnderstaffedItem[]> {
  return tx<UnderstaffedItem[]>`
    select x.id as "eventId", x.date, x.start, x.concert, x.free from (
      select e.id, to_char(e.event_date, 'YYYY-MM-DD') as date, to_char(e.start_time, 'HH24:MI') as start, e.concert,
        e.event_date, e.start_time,
        ((select coalesce(sum(s.quantity), 0) from event_slot s where s.event_id = e.id)
          - (select count(*) from assignment a where a.event_id = e.id))::int as free
      from event e
      where e.event_date between ${today}::date and ${addDays(today, days)}::date
        and exists (select 1 from month mo where mo.month = to_char(e.event_date, 'YYYY-MM') and mo.status = 'published')
    ) x where x.free > 0 order by x.event_date, x.start_time`;
}
