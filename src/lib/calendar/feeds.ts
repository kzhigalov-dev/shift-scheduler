import type { Tx } from '@/db/client';
import { formatMoney } from '@/lib/format';
import { shiftsSince, type Shift } from '@/app/(worker)/queries';
import { addMinutes, buildCalendar, CALENDAR_LOCATION, EVENT_MINUTES, type IcsEvent } from './ics';
import { moscowDateMinusDays } from './urls';

export const FEED_DAYS_BACK = 60;
export const ICS_HEADERS: Record<string, string> = {
  'Content-Type': 'text/calendar; charset=utf-8',
  'Cache-Control': 'no-store',
};

type Opts = { now: Date; origin: string };

/** Начало раньше 06:00 — ночное: приход в тот же вечер, накануне. */
const NIGHT_START_MINUTES = 6 * 60;
const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

export function shiftToIcs(shift: Shift, workerId: string, origin: string): IcsEvent {
  const end = addMinutes(shift.date, shift.startTime, EVENT_MINUTES);
  // Приход — за `delta` минут до начала. Приход «позже» начала по часам — это вчерашний вечер только для
  // ночного начала (до 06:00: 23:00 → 00:30); иначе это опечатка (20:15 при начале 20:00): событие начинается со start.
  const diff = shift.arriveTime ? toMinutes(shift.startTime) - toMinutes(shift.arriveTime) : 0;
  const delta = diff >= 0 ? diff : toMinutes(shift.startTime) < NIGHT_START_MINUTES ? diff + 1440 : 0;
  const arrive = addMinutes(shift.date, shift.startTime, -delta);
  const lines = [
    `Начало: ${shift.startTime}`,
    shift.amount !== null ? `Ставка: ${formatMoney(shift.amount)}` : 'Ставка уточняется',
    ...(shift.cancelRequested ? ['Отмена запрошена'] : []),
    `${origin}/shifts`,
  ];
  return {
    uid: `shift-${shift.eventId}-${workerId}@annenkirche-shifts`,
    date: arrive.date,
    startTime: arrive.time,
    endDate: end.date,
    endTime: end.time,
    summary: `Смена · ${shift.position ?? 'без должности'} · ${shift.concert ?? 'мероприятие'}`,
    description: lines.join('\n'),
    location: CALENDAR_LOCATION,
  };
}

export async function workerFeed(tx: Tx, workerId: string, { now, origin }: Opts): Promise<string> {
  const shifts = await shiftsSince(tx, workerId, moscowDateMinusDays(now, FEED_DAYS_BACK));
  return buildCalendar({
    name: 'Мои смены · Анненкирхе', now, events: shifts.map((s) => shiftToIcs(s, workerId, origin)),
  });
}

/** Файл одной смены работника; чужая или черновая смена — null (RLS её не покажет). */
export async function workerShiftFile(tx: Tx, workerId: string, eventId: string, { now, origin }: Opts) {
  const shift = (await shiftsSince(tx, workerId, '1900-01-01')).find((s) => s.eventId === eventId);
  if (!shift) return null;
  return { date: shift.date, body: buildCalendar({ name: 'Смена · Анненкирхе', now, events: [shiftToIcs(shift, workerId, origin)] }) };
}

type ManagerRow = {
  id: string; event_date: string; start_time: string; arrive_time: string | null;
  concert: string | null; draft: boolean;
};

export async function managerFeed(tx: Tx, { now, origin }: Opts): Promise<string> {
  const from = moscowDateMinusDays(now, FEED_DAYS_BACK);
  const events = await tx<ManagerRow[]>`
    select e.id, to_char(e.event_date, 'YYYY-MM-DD') as event_date, to_char(e.start_time, 'HH24:MI') as start_time,
           to_char(e.arrive_time, 'HH24:MI') as arrive_time, e.concert,
           coalesce(m.status = 'draft', false) as draft
    from event e left join month m on m.month = to_char(e.event_date, 'YYYY-MM')
    where e.event_date >= ${from}::date
    order by e.event_date, e.start_time`;
  const slots = await tx<Array<{ event_id: string; name: string; quantity: number; sort_order: number }>>`
    select s.event_id, p.name, s.quantity, p.sort_order
    from event_slot s join position p on p.id = s.position_id join event e on e.id = s.event_id
    where e.event_date >= ${from}::date and s.quantity > 0
    order by p.sort_order, p.name`;
  const people = await tx<Array<{ event_id: string; position: string | null; full_name: string }>>`
    select a.event_id, p.name as position, w.full_name
    from assignment a join worker w on w.id = a.worker_id join event e on e.id = a.event_id
    left join position p on p.id = a.position_id
    where e.event_date >= ${from}::date
    order by a.created_at, w.full_name`;

  const icsEvents = events.map((e): IcsEvent => {
    const own = slots.filter((s) => s.event_id === e.id);
    const assigned = people.filter((p) => p.event_id === e.id);
    const needed = own.reduce((sum, s) => sum + s.quantity, 0);
    const lines = [`Приход: ${e.arrive_time ?? '—'}`];
    for (const s of own) {
      const names = assigned.filter((p) => p.position === s.name).map((p) => p.full_name);
      const free = Math.max(0, s.quantity - names.length);
      lines.push(`${s.name}: ${[...names, ...Array.from({ length: free }, () => 'свободно')].join(', ')}`);
    }
    const unplaced = assigned.filter((p) => p.position === null).map((p) => p.full_name);
    if (unplaced.length) lines.push(`Без должности: ${unplaced.join(', ')}`);
    // Назначены на должность, под которую в событии нет мест: иначе их не видно ни в одной строке выше.
    const other = assigned.filter((p) => p.position !== null && !own.some((s) => s.name === p.position))
      .map((p) => `${p.full_name} (${p.position})`);
    if (other.length) lines.push(`Прочие: ${other.join(', ')}`);
    lines.push(`${origin}/event/${e.id}`);
    const end = addMinutes(e.event_date, e.start_time, EVENT_MINUTES);
    return {
      uid: `event-${e.id}@annenkirche-shifts`,
      date: e.event_date, startTime: e.start_time, endDate: end.date, endTime: end.time,
      summary: `${e.draft ? '[черновик] ' : ''}${e.concert ?? 'Мероприятие'} · ${assigned.length}/${needed}`,
      description: lines.join('\n'),
      location: CALENDAR_LOCATION,
    };
  });
  return buildCalendar({ name: 'Мероприятия · Анненкирхе', now, events: icsEvents });
}
