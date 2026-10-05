import type { Tx } from '@/db/client';
import { UserError } from '@/lib/errors';
import { isUuid } from '@/lib/ids';
import { getEventTypeSettings, resolveEventType } from './operations';
import type { TypeSlot } from './types';
export type CurrentSlot = { positionId: string; quantity: number; people: number };
export type TemplateQuantity = { positionId: string; quantity: number };
/** `wanted < to` — шаблон хотел меньше, но на должности стоят люди. */
export type SlotChange = { positionId: string; from: number; to: number; wanted: number };
export type TemplatePlan = { changes: SlotChange[]; changed: boolean };

/**
 * Никто не снимается: новое количество = max(шаблон, людей на должности).
 * Должности вне шаблона считаются нулём. Порядок — как в шаблоне, затем остальные.
 */
export function planTemplateApply(current: CurrentSlot[], template: TemplateQuantity[]): TemplatePlan {
  const byId = new Map(current.map(s=>[s.positionId,s]));
  const wanted = new Map(template.map(t=>[t.positionId,t.quantity]));
  const ids = [...new Set([...template.map(t=>t.positionId),...current.map(s=>s.positionId)])];
  const changes: SlotChange[] = [];
  for (const positionId of ids) {
    const from = byId.get(positionId)?.quantity ?? 0;
    const people = byId.get(positionId)?.people ?? 0;
    const want = wanted.get(positionId) ?? 0;
    const to = Math.max(want,people);
    if (to !== from) changes.push({positionId,from,to,wanted:want});
  }
  return {changes,changed:changes.length>0};
}

const NBSP = '\u00a0';
/**
 * «БИЛЕТЫ 3 → 4», «БАЛКОН +1», «ЗАЛ 3 → 2 (стоят люди, меньше нельзя)», «ЗАЛ 1 → 2 (по числу людей)»,
 * «ВХОД 1 → 0 (ставка места сбросится)». `rateLost` — у удаляемого места своя ставка.
 */
export function changeLabel(name: string, c: Pick<SlotChange,'from'|'to'|'wanted'>, rateLost = false): string {
  const text = c.from === 0 ? `${name}${NBSP}+${c.to}` : `${name} ${c.from}${NBSP}→${NBSP}${c.to}`;
  if (c.wanted < c.to) return `${text} (${c.to < c.from ? 'стоят люди, меньше нельзя' : 'по числу людей'})`;
  return rateLost && c.to === 0 ? `${text} (ставка места сбросится)` : text;
}

export type TemplateChange = SlotChange & { positionName: string; label: string };
export type EventTemplatePlan = { eventId: string; date: string; startTime: string; concert: string | null; changes: TemplateChange[] };
export type TypeApplyPreview = { typeId: string; typeName: string; events: EventTemplatePlan[]; unchanged: number };
export type EventApplyPreview = { eventId: string; typeId: string; typeName: string; changes: TemplateChange[] };
export type TemplateApplyResult = { applied: number; eventIds: string[]; months: string[] };
type EventRow = { id: string; date: string; start_time: string; concert: string | null; event_type_id: string };

/**
 * Состав мероприятий против шаблона. `lock` — для записи: места блокируются до подсчёта людей,
 * как в assignWorker, поэтому одновременное назначение либо уже учтено, либо увидит новое количество.
 */
async function planEvents(tx: Tx, events: EventRow[], template: TypeSlot[], lock: boolean): Promise<EventTemplatePlan[]> {
  if (events.length === 0) return [];
  const ids = events.map(e=>e.id);
  const slots = await tx<{event_id:string;position_id:string;quantity:number;rate:number|null}[]>`select event_id,position_id,quantity,rate
    from event_slot where event_id in ${tx(ids)} order by event_id,position_id ${lock?tx`for update`:tx``}`;
  const people = await tx<{event_id:string;position_id:string;people:number}[]>`select event_id,position_id,count(*)::int as people
    from assignment where event_id in ${tx(ids)} and position_id is not null group by event_id,position_id`;
  const names = new Map(template.map(t=>[t.positionId,t.positionName]));
  return events.map(e=>{
    const current = new Map<string,CurrentSlot>();
    for (const s of slots) if (s.event_id===e.id) current.set(s.position_id,{positionId:s.position_id,quantity:s.quantity,people:0});
    for (const p of people) if (p.event_id===e.id) {
      current.set(p.position_id,{positionId:p.position_id,quantity:current.get(p.position_id)?.quantity??0,people:p.people});
    }
    const changes = planTemplateApply([...current.values()],template).changes.map(c=>{
      const positionName = names.get(c.positionId) ?? '';
      const rate = slots.find(s=>s.event_id===e.id&&s.position_id===c.positionId)?.rate ?? null;
      return {...c,positionName,label:changeLabel(positionName,c,rate!==null)};
    });
    return {eventId:e.id,date:e.date,startTime:e.start_time,concert:e.concert,changes};
  });
}
/** Ноль без людей — строка места удаляется вместе со ставкой; иначе меняется только количество. */
async function writePlans(tx: Tx, plans: EventTemplatePlan[]): Promise<TemplateApplyResult> {
  const changed = plans.filter(p=>p.changes.length>0);
  for (const p of changed) for (const c of p.changes) {
    if (c.to === 0) await tx`delete from event_slot where event_id=${p.eventId} and position_id=${c.positionId}`;
    else {
      const [slot] = await tx<{ inserted: boolean }[]>`insert into event_slot(event_id,position_id,quantity)
        values (${p.eventId},${c.positionId},${c.to})
        on conflict (event_id,position_id) do update set quantity=excluded.quantity
        returning (xmax = 0) as inserted`;
      // Как у setSlot: недостающее место уже начавшегося мероприятия не получает
      // нынешнюю ставку вида. Существующие снимки и ручные ставки сохраняются.
      if (slot.inserted) await tx`update event_slot set type_rate=null
        where event_id=${p.eventId} and position_id=${c.positionId}
          and exists (select 1 from event e where e.id=${p.eventId} and e.event_date + e.start_time <= localtimestamp)`;
    }
  }
  return {applied:changed.length,eventIds:changed.map(p=>p.eventId),months:[...new Set(changed.map(p=>p.date.slice(0,7)))].sort()};
}
async function planType(tx: Tx, typeId: string, today: string, lock: boolean) {
  await resolveEventType(tx,{id:typeId});
  const type = await getEventTypeSettings(tx,typeId);
  const events = await tx<EventRow[]>`select id,to_char(event_date,'YYYY-MM-DD') as date,to_char(start_time,'HH24:MI') as start_time,
    concert,event_type_id from event where event_type_id=${typeId} and event_date>=${today}::date
    order by event_date,start_time ${lock?tx`for share`:tx``}`;
  return {type,plans:await planEvents(tx,events,type.slots,lock)};
}
/** Будущие (дата ≥ today по Москве) мероприятия действующего вида: что изменится. Ничего не пишет. */
export async function previewTypeApply(tx: Tx, typeId: string, today: string): Promise<TypeApplyPreview> {
  const {type,plans} = await planType(tx,typeId,today,false);
  const events = plans.filter(p=>p.changes.length>0);
  return {typeId:type.id,typeName:type.name,events,unchanged:plans.length-events.length};
}
/** Пересчитывает заново (предпросмотр мог устареть) и пишет в той же транзакции. */
export async function applyTypeTemplate(tx: Tx, typeId: string, today: string): Promise<TemplateApplyResult> {
  return writePlans(tx,(await planType(tx,typeId,today,true)).plans);
}
async function planEvent(tx: Tx, eventId: string, today: string, lock: boolean) {
  if (!isUuid(eventId)) throw new UserError('Некорректное мероприятие');
  const [event] = await tx<EventRow[]>`select id,to_char(event_date,'YYYY-MM-DD') as date,to_char(start_time,'HH24:MI') as start_time,
    concert,event_type_id from event where id=${eventId} ${lock?tx`for share`:tx``}`;
  if (!event) throw new UserError('Мероприятие не найдено — обновите страницу');
  const type = await getEventTypeSettings(tx,event.event_type_id);
  const past = event.date < today;
  return {type,past,plan:past ? null : (await planEvents(tx,[event],type.slots,lock))[0]};
}
/** Разница с шаблоном вида у одного мероприятия; у прошедшего — пусто. Вид может быть в архиве. */
export async function previewEventApply(tx: Tx, eventId: string, today: string): Promise<EventApplyPreview> {
  const {type,plan} = await planEvent(tx,eventId,today,false);
  return {eventId,typeId:type.id,typeName:type.name,changes:plan?.changes ?? []};
}
export async function applyEventTemplate(tx: Tx, eventId: string, today: string): Promise<TemplateApplyResult> {
  const {past,plan} = await planEvent(tx,eventId,today,true);
  if (past || !plan) throw new UserError('Шаблон применяется только к будущим мероприятиям');
  return writePlans(tx,[plan]);
}
