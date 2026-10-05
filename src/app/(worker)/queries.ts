import type { Tx } from '@/db/client';
import { UserError } from '@/lib/errors';
import { calculatePay, shiftAmount, type RateRange } from '@/lib/pay/calculatePay';
import { eventRateRanges } from '@/lib/pay/eventRates';
import { monthRange } from '@/lib/month';
import { earningsBars, type EarningsBar } from '@/lib/summaries/worker';

export type Shift = {
  eventId: string;
  date: string;
  startTime: string;
  arriveTime: string | null;
  concert: string | null;
  position: string | null;
  amount: number | null;
  cancelRequested: boolean;
};

export type AvailableEvent = {
  eventId: string;
  date: string;
  startTime: string;
  concert: string | null;
  /** Ставка, которую работник получит (`rateRange`: места с учётом ставок вида, затем базовая); null — уточняется. */
  rate: RateRange | null;
  signupStatus: 'pending' | 'accepted' | 'rejected' | null;
};

type ShiftRow = {
  event_id: string; event_date: string; start_time: string; arrive_time: string | null;
  concert: string | null; position: string | null; person_rate: number | null;
  slot_rate: number | null; position_rate: number | null; event_rate: number | null;
  cancel_requested: boolean; full_name: string;
};

/**
 * Назначения работника со всеми уровнями ставок. RLS и так режет чужое.
 * `from = null` — от сегодняшнего дня (по часовому поясу транзакции,
 * Europe/Moscow): `coalesce` вместо отдельного запроса за current_date.
 */
function shiftRows(tx: Tx, workerId: string, from: string | null, to: string | null) {
  return tx<ShiftRow[]>`
    select a.event_id,
           to_char(e.event_date, 'YYYY-MM-DD') as event_date,
           to_char(e.start_time, 'HH24:MI') as start_time,
           to_char(e.arrive_time, 'HH24:MI') as arrive_time,
           e.concert, p.name as position,
           a.rate as person_rate, coalesce(s.rate,s.type_rate) as slot_rate,
           p.default_rate as position_rate, e.base_rate as event_rate,
           a.cancel_requested_at is not null as cancel_requested,
           w.full_name
    from assignment a
    join event e on e.id = a.event_id
    join worker w on w.id = a.worker_id
    left join position p on p.id = a.position_id
    left join event_slot s on s.event_id = a.event_id and s.position_id = a.position_id
    where a.worker_id = ${workerId}
      and e.event_date >= coalesce(${from}::date, current_date)
      and (${to}::date is null or e.event_date < ${to}::date)
    order by e.event_date, e.start_time`;
}

const levels = (r: ShiftRow) => ({
  personRate: r.person_rate, slotRate: r.slot_rate,
  positionRate: r.position_rate, eventRate: r.event_rate,
});

const toShift = (r: ShiftRow): Shift => ({
  eventId: r.event_id, date: r.event_date, startTime: r.start_time,
  arriveTime: r.arrive_time, concert: r.concert, position: r.position,
  amount: shiftAmount(levels(r)), cancelRequested: r.cancel_requested,
});

export async function myShifts(tx: Tx, workerId: string): Promise<Shift[]> {
  const rows = await shiftRows(tx, workerId, null, null);
  return rows.map(toShift);
}

/** Назначения работника с даты `from` (включительно) — для календаря. */
export async function shiftsSince(tx: Tx, workerId: string, from: string): Promise<Shift[]> {
  const rows = await shiftRows(tx, workerId, from, null);
  return rows.map(toShift);
}

/** Свои смены месяца целиком (и прошедшие) — для сетки месяца. */
export async function monthShifts(tx: Tx, workerId: string, month: string): Promise<Shift[]> {
  const { from, to } = monthRange(month);
  return (await shiftRows(tx, workerId, from, to)).map(toShift);
}

export async function availableEvents(tx: Tx, workerId: string): Promise<AvailableEvent[]> {
  const rows = await tx<Array<{
    id: string; event_date: string; start_time: string; concert: string | null;
    status: AvailableEvent['signupStatus'];
  }>>`
    select e.id,
           to_char(e.event_date, 'YYYY-MM-DD') as event_date,
           to_char(e.start_time, 'HH24:MI') as start_time,
           e.concert, g.status::text as status
    from event e
    left join signup g on g.event_id = e.id and g.worker_id = ${workerId}
    where e.event_date >= current_date
      and not exists (
        select 1 from assignment a where a.event_id = e.id and a.worker_id = ${workerId})
    order by e.event_date, e.start_time`;

  const rates = await eventRateRanges(tx, rows.map((r) => r.id));
  return rows.map((r) => ({
    eventId: r.id, date: r.event_date, startTime: r.start_time,
    concert: r.concert, rate: rates.get(r.id) ?? null, signupStatus: r.status ?? null,
  }));
}

/** Свободные события месяца с сегодняшнего дня — для сетки месяца. */
export async function monthAvailable(tx: Tx, workerId: string, month: string): Promise<AvailableEvent[]> {
  return (await availableEvents(tx, workerId)).filter((e) => e.date.startsWith(`${month}-`));
}

/** Лимит заявок и отзывов работника (`note_signup_toggle`, 0015): всего за 10 минут и на одно мероприятие за час. */
export const SIGNUP_TOGGLES_PER_10_MIN = 60;
export const SIGNUP_TOGGLES_PER_EVENT_HOUR = 6;
export const SIGNUP_TOO_OFTEN = 'Слишком много заявок и отзывов подряд — подождите несколько минут и попробуйте снова.';

/**
 * Каждая заявка и отзыв учитываются на сервере (M3 ревью безопасности): по кругу «заявка → отзыв» нельзя
 * завалить менеджера уведомлениями. Работник — из личности транзакции (withWorker), не из аргумента.
 */
async function noteToggle(tx: Tx, eventId: string): Promise<void> {
  const [row] = await tx<{ ok: boolean }[]>`select note_signup_toggle(${eventId}) as ok`;
  if (!row.ok) throw new UserError(SIGNUP_TOO_OFTEN);
}

/**
 * Отвергает прошедшее событие, событие, где уже есть назначение, и повтор
 * отклонённой заявки — одним запросом с проверкой, без гонки между select
 * и insert. RLS (signup_create, 0003) дублирует проверку даты в глубину.
 */
export async function createSignup(
  tx: Tx, { workerId, eventId }: { workerId: string; eventId: string },
): Promise<void> {
  await noteToggle(tx, eventId);
  const inserted = await tx`
    insert into signup (worker_id, event_id)
    select ${workerId}, e.id from event e
    where e.id = ${eventId} and e.event_date >= current_date
      and not exists (select 1 from assignment a where a.event_id = e.id and a.worker_id = ${workerId})
    on conflict (worker_id, event_id) do nothing
    returning id`;
  if (inserted.length === 0) {
    const [s] = await tx<{ status: string }[]>`select status::text as status from signup
      where worker_id = ${workerId} and event_id = ${eventId}`;
    if (s?.status === 'pending') return; // повтор — идемпотентно
    if (s?.status === 'rejected') throw new UserError('Заявку на это событие отклонили');
    throw new UserError('Событие уже прошло или вы уже на нём');
  }
}

export async function withdrawSignup(
  tx: Tx, { workerId, eventId }: { workerId: string; eventId: string },
): Promise<void> {
  await noteToggle(tx, eventId);
  const deleted = await tx`
    delete from signup
    where worker_id = ${workerId} and event_id = ${eventId} and status = 'pending'
    returning id`;
  if (deleted.length > 0) return;

  // Не удалилось — нужно сказать почему: заявку уже обработали или её нет вовсе.
  const [s] = await tx<{ status: string }[]>`
    select status::text as status from signup
    where worker_id = ${workerId} and event_id = ${eventId}`;
  if (s?.status === 'accepted') {
    throw new UserError('Заявка уже принята — нажмите «Не смогу» в «Моих сменах»');
  }
  if (s?.status === 'rejected') throw new UserError('Заявку уже отклонили');
  throw new UserError('Заявки нет — обновите страницу');
}

export async function requestCancel(tx: Tx, eventId: string): Promise<void> {
  const [row] = await tx<{ ok: boolean }[]>`select request_cancel(${eventId}) as ok`;
  if (!row.ok) throw new UserError('Отмена уже запрошена или смена не найдена');
}

/** Заработок по строкам назначений: правила — `calculatePay` / `shiftAmount`, как на экране «Оплата». */
function summarize(rows: ShiftRow[], workerId: string) {
  const [summary] = calculatePay(rows.map((r) => ({
    workerId, fullName: r.full_name, ...levels(r),
  })));
  return {
    shifts: summary?.shifts ?? 0,
    total: summary?.total ?? 0,
    unpriced: summary?.unpriced ?? 0,
    items: rows.map((r) => ({
      date: r.event_date, concert: r.concert, position: r.position,
      amount: shiftAmount(levels(r)),
    })),
  };
}

export type Earnings = ReturnType<typeof summarize>;

export async function myEarnings(tx: Tx, workerId: string, month: string): Promise<Earnings> {
  const { from, to } = monthRange(month);
  return summarize(await shiftRows(tx, workerId, from, to), workerId);
}

/**
 * Экран «Заработок» одним запросом: смены окна месяцев `window` (`YYYY-MM`, включительно) —
 * столбики по месяцам, и выбранный месяц `month` (лежит в окне) — итог и список, как `myEarnings`.
 */
export async function earningsOverview(
  tx: Tx, workerId: string, month: string, window: { from: string; to: string },
): Promise<{ selected: Earnings; bars: EarningsBar[] }> {
  const rows = await shiftRows(tx, workerId, monthRange(window.from).from, monthRange(window.to).to);
  return {
    selected: summarize(rows.filter((r) => r.event_date.startsWith(`${month}-`)), workerId),
    bars: earningsBars(rows.map((r) => ({ date: r.event_date, amount: shiftAmount(levels(r)) })), window),
  };
}
