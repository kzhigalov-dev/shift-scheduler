import postgres from 'postgres';
import type { Tx } from '@/db/client';
import { UserError } from '@/lib/errors';
import { isUuid } from '@/lib/ids';
import { checkQuantity } from '@/lib/quantity';
import { EVENT_TAGS } from '@/lib/eventTags';
import { MAX_RATE } from '@/lib/events';
import { normalizeTypeName } from './validation';
import type { EventType, EventTypeSettings, TypeSlot, TypeFormInput, TypeLookup, EventTypeOption } from './types';

function checkId(id: string): void {
  if (!isUuid(id)) throw new UserError('Некорректный вид мероприятия');
}
export async function listEventTypes(tx: Tx, filter?: { archived?: boolean }): Promise<EventType[]> {
  return tx<EventType[]>`select id, name, system_tag as "systemTag", archived, sort_order as "sortOrder"
    from event_type where (${filter?.archived === undefined} or archived = ${filter?.archived ?? false})
    order by sort_order, name, id`;
}
export async function eventTypeOptions(tx: Tx, currentTypeId?: string): Promise<EventTypeOption[]> {
  return (await listEventTypes(tx)).filter(t => !t.archived || t.id === currentTypeId)
    .map(t => ({ id:t.id, name:t.archived ? `${t.name} (в архиве)` : t.name, tag:t.systemTag ?? 'regular' }));
}
export async function defaultTypeSlots(tx: Tx): Promise<TypeSlot[]> {
  return tx<TypeSlot[]>`select id as "positionId", name as "positionName", default_quantity as quantity, null::integer as rate
    from position order by sort_order`;
}
export async function getEventTypeSettings(tx: Tx, id: string): Promise<EventTypeSettings> {
  checkId(id);
  const [type] = await tx<EventType[]>`select id,name,system_tag as "systemTag",archived,sort_order as "sortOrder"
    from event_type where id=${id} for share`;
  if (!type) throw new UserError('Вид мероприятия не найден');
  const slots = await tx<TypeSlot[]>`select p.id as "positionId",p.name as "positionName",coalesce(s.quantity,0) as quantity,s.rate
    from position p left join event_type_slot s on s.position_id=p.id and s.event_type_id=${id}
    order by p.sort_order`;
  return { ...type, slots };
}
export async function saveEventType(tx: Tx, input: TypeFormInput): Promise<string> {
  const { name } = normalizeTypeName(input.name);
  if (input.id !== null) checkId(input.id);
  const positions = await tx<{id:string}[]>`select id from position`;
  const ids = new Set(input.slots.map(s=>s.positionId));
  if (input.slots.length !== positions.length || ids.size !== positions.length || positions.some(p=>!ids.has(p.id))) {
    throw new UserError('Укажите количество для каждой должности ровно один раз');
  }
  input.slots.forEach(s=>checkQuantity(s.quantity));
  for (const slot of input.slots) {
    if (slot.rate !== undefined && slot.rate !== null && (!Number.isInteger(slot.rate) || slot.rate < 0 || slot.rate > MAX_RATE)) {
      throw new UserError('Ставка — целое число от 0 до 1 000 000 ₽');
    }
  }
  try {
    return await tx.savepoint(async sp => {
      let id = input.id;
      if (id !== null) {
        const [existing] = await sp`select id from event_type where id=${id} for update`;
        if (!existing) throw new UserError('Вид мероприятия не найден');
        await sp`update event_type set name=${name} where id=${id}`;
      } else {
        const [created] = await sp`insert into event_type(name,sort_order)
          values (${name},(select coalesce(max(sort_order),0)+1 from event_type)) returning id`;
        id = created.id as string;
      }
      for (const slot of input.slots) {
        await sp`insert into event_type_slot(event_type_id,position_id,quantity,rate)
          values (${id},${slot.positionId},${slot.quantity},${slot.rate ?? null})
          on conflict (event_type_id,position_id) do update set quantity=excluded.quantity,
            rate=case when ${slot.rate !== undefined} then excluded.rate else event_type_slot.rate end`;
      }
      if (input.slots.some(s => s.rate !== undefined)) await refreshFutureTypeRates(sp, id);
      return id;
    });
  } catch (error) {
    if (error instanceof postgres.PostgresError && error.code === '23505') {
      throw new UserError('Вид с таким названием уже существует, в том числе в архиве');
    }
    throw error;
  }
}

/**
 * Вид уже заблокирован: вид → мероприятия → места, как при применении состава. Обновляются только
 * мероприятия, которые ещё не начались, — по часам базы (`localtimestamp`, транзакция в Europe/Moscow):
 * одни часы во всех путях ставок вида; начавшееся сегодня мероприятие — уже прошлое для оплаты.
 */
async function refreshFutureTypeRates(tx: Tx, typeId: string): Promise<void> {
  const events = await tx<{ id: string }[]>`select id from event
    where event_type_id=${typeId} and event_date + start_time > localtimestamp
    order by event_date,start_time,id for share`;
  if (events.length === 0) return;
  const ids = events.map(e => e.id);
  await tx`select event_id,position_id from event_slot where event_id in ${tx(ids)} order by event_id,position_id for update`;
  await tx`update event_slot s set type_rate=(select t.rate from event_type_slot t
    where t.event_type_id=${typeId} and t.position_id=s.position_id)
    where s.event_id in ${tx(ids)} and s.type_rate is distinct from (select t.rate from event_type_slot t
      where t.event_type_id=${typeId} and t.position_id=s.position_id)`;
}

/** Выбранный вид и мероприятие уже заблокированы; снимки начавшихся и прошлых мероприятий не меняем. */
export async function refreshEventTypeRate(tx: Tx, eventId: string, typeId: string): Promise<void> {
  const [event] = await tx`select id from event where id=${eventId} and event_date + start_time > localtimestamp`;
  if (!event) return;
  await tx`select position_id from event_slot where event_id=${eventId} order by position_id for update`;
  await tx`update event_slot s set type_rate=(select t.rate from event_type_slot t
    where t.event_type_id=${typeId} and t.position_id=s.position_id) where s.event_id=${eventId}`;
}
export async function setEventTypeArchived(tx: Tx, id: string, archived: boolean): Promise<void> {
  checkId(id);
  if (typeof archived !== 'boolean') throw new UserError('Некорректное состояние вида');
  const [type] = await tx`select id from event_type where id=${id} for update`;
  if (!type) throw new UserError('Вид мероприятия не найден');
  await tx`update event_type set archived=${archived} where id=${id}`;
}
export async function resolveEventType(tx: Tx, lookup: TypeLookup): Promise<EventType> {
  if ([lookup.id,lookup.name,lookup.systemTag].filter(v=>v !== undefined).length !== 1) {
    throw new UserError('Укажите один вид мероприятия');
  }
  if (lookup.id !== undefined) checkId(lookup.id);
  if (lookup.currentTypeId !== undefined) checkId(lookup.currentTypeId);
  if (lookup.systemTag !== undefined && !EVENT_TAGS.includes(lookup.systemTag)) throw new UserError('Некорректный вид мероприятия');
  const key = lookup.name === undefined ? null : normalizeTypeName(lookup.name).key;
  const [type] = await tx<EventType[]>`select id,name,system_tag as "systemTag",archived,sort_order as "sortOrder"
    from event_type where id=${lookup.id ?? null} or name_key=${key} or system_tag=${lookup.systemTag ?? null} for share`;
  if (!type) throw new UserError(`Вид мероприятия${lookup.name ? ` «${lookup.name}»` : ''} не найден`);
  if (type.archived && type.id !== lookup.currentTypeId) throw new UserError(`Вид «${type.name}» находится в архиве — восстановите его или выберите другой`);
  return type;
}
export async function copyEventTypeSlots(tx: Tx, eventId: string, typeId: string): Promise<void> {
  await resolveEventType(tx,{id:typeId});
  await tx`insert into event_slot(event_id,position_id,quantity)
    select ${eventId},position_id,quantity from event_type_slot where event_type_id=${typeId} and quantity>0
    on conflict (event_id,position_id) do nothing`;
}
