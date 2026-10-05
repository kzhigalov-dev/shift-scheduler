import { beforeEach, describe, expect, it } from 'vitest';
import { asManager, resetTestDb, testSql } from './setup';
import { UserError } from '@/lib/errors';
import { applyDistribution, loadDistribution, previewDistribution } from '@/lib/distribute/operations';
import type { RandomInt } from '@/lib/distribute/distribute';
import { assignWorker } from '@/app/(manager)/event/[id]/operations';

const TODAY = '2099-10-10';
const first: RandomInt = () => 0;
beforeEach(() => resetTestDb());

const position = async (name: string) => (await testSql`select id from position where name = ${name}`)[0].id as string;
async function worker(name: string, status: 'active' | 'archived' = 'active'): Promise<string> {
  const [w] = await testSql`insert into worker (full_name, name_key, status) values (${name}, ${name.toLowerCase()}, ${status}) returning id`;
  return w.id as string;
}
/** Мероприятие с местами `slots` (имя должности → мест); остальных мест нет. */
async function event(date: string, slots: Record<string, number>, time = '19:00', concert = `Концерт ${date}`): Promise<string> {
  const [e] = await testSql`insert into event (event_date, start_time, concert, tag) values (${date}, ${time}, ${concert}, 'regular') returning id`;
  await testSql`delete from event_slot where event_id = ${e.id}`;
  for (const [name, quantity] of Object.entries(slots)) {
    await testSql`insert into event_slot (event_id, position_id, quantity) values (${e.id}, ${await position(name)}, ${quantity})`;
  }
  return e.id as string;
}
async function assign(eventId: string, workerId: string, positionName: string | null, extra: { rate?: number; cancel?: boolean } = {}) {
  const positionId = positionName === null ? null : await position(positionName);
  await testSql`insert into assignment (worker_id, event_id, position_id, rate, cancel_requested_at)
    values (${workerId}, ${eventId}, ${positionId}, ${extra.rate ?? null}, ${extra.cancel ? testSql`now()` : null})`;
}
const placement = (eventId: string) => testSql<{ worker_id: string; name: string | null; rate: number | null }[]>`
  select a.worker_id, p.name, a.rate from assignment a left join position p on p.id = a.position_id
  where a.event_id = ${eventId} order by a.worker_id`;
const nameOf = async (eventId: string, workerId: string) =>
  (await placement(eventId)).find((r) => r.worker_id === workerId)?.name ?? null;

/** Мероприятие: АДМИН 1, ЗАЛ 2 (одна занята), БИЛЕТЫ 3, ВХОД 1 (занят); без должности — Анна, Борис, Вера. */
async function setup(date = '2099-10-15') {
  const id = await event(date, { 'АДМИН': 1, 'ЗАЛ': 2, 'БИЛЕТЫ': 3, 'ВХОД': 1 });
  const [anna, boris, vera, gleb, dina] = [await worker('Анна'), await worker('Борис'), await worker('Вера'), await worker('Глеб'), await worker('Дина')];
  await assign(id, gleb, 'ЗАЛ');
  await assign(id, dina, 'ВХОД', { rate: 1500 });
  await assign(id, vera, null, { rate: 1700 });
  await assign(id, anna, null);
  await assign(id, boris, null);
  return { id, anna, boris, vera, gleb, dina };
}

describe('loadDistribution', () => {
  it('одно мероприятие: люди без должности по алфавиту и свободные места без АДМИН и без занятых', async () => {
    const s = await setup();
    const [hall, tickets] = [await position('ЗАЛ'), await position('БИЛЕТЫ')];
    const events = await asManager((tx) => loadDistribution(tx, { eventId: s.id }));
    expect(events).toEqual([{
      eventId: s.id, date: '2099-10-15', startTime: '19:00', concert: 'Концерт 2099-10-15',
      people: [{ workerId: s.anna, fullName: 'Анна' }, { workerId: s.boris, fullName: 'Борис' }, { workerId: s.vera, fullName: 'Вера' }],
      free: [{ positionId: hall, name: 'ЗАЛ', free: 1 }, { positionId: tickets, name: 'БИЛЕТЫ', free: 3 }],
    }]);
  });

  it('архивные и запросившие отмену не распределяются', async () => {
    const s = await setup();
    await testSql`update worker set status = 'archived' where id = ${s.anna}`;
    await testSql`update assignment set cancel_requested_at = now() where worker_id = ${s.boris}`;
    const [e] = await asManager((tx) => loadDistribution(tx, { eventId: s.id }));
    expect(e.people.map((p) => p.fullName)).toEqual(['Вера']);
  });

  it('нечего распределять — пусто: все расставлены или мест не-АДМИН нет', async () => {
    const placed = await event('2099-10-16', { 'ЗАЛ': 2 });
    await assign(placed, await worker('Ефим'), 'ЗАЛ');
    expect(await asManager((tx) => loadDistribution(tx, { eventId: placed }))).toEqual([]);
    const adminOnly = await event('2099-10-17', { 'АДМИН': 1, 'ЗАЛ': 1 });
    await assign(adminOnly, await worker('Жанна'), 'ЗАЛ');
    await assign(adminOnly, await worker('Зоя'), null);
    expect(await asManager((tx) => loadDistribution(tx, { eventId: adminOnly }))).toEqual([]);
  });

  it('прошедшее мероприятие по одному — тоже распределяется', async () => {
    const s = await setup('2099-10-01');
    expect(await asManager((tx) => loadDistribution(tx, { eventId: s.id }))).toHaveLength(1);
  });

  it('неизвестное мероприятие — понятная ошибка', async () => {
    await expect(asManager((tx) => loadDistribution(tx, { eventId: '00000000-0000-4000-8000-000000000000' })))
      .rejects.toThrow(UserError);
  });

  it('месяц: только мероприятия с сегодняшнего дня, где есть кого и куда ставить, по дате и времени', async () => {
    const past = await setup('2099-10-09');
    const today = await event(TODAY, { 'БИЛЕТЫ': 1 }, '20:00');
    const todayEarly = await event(TODAY, { 'ЗАЛ': 1 }, '12:00');
    const nothing = await event('2099-10-20', { 'ЗАЛ': 1 });
    const nextMonth = await event('2099-11-01', { 'ЗАЛ': 1 });
    for (const id of [today, todayEarly, nothing, nextMonth]) await assign(id, past.anna, id === nothing ? 'ЗАЛ' : null);
    const events = await asManager((tx) => loadDistribution(tx, { month: '2099-10', today: TODAY }));
    expect(events.map((e) => e.eventId)).toEqual([todayEarly, today]);
    expect(events[0].startTime).toBe('12:00');
  });

  it('пустой месяц — пусто', async () => {
    expect(await asManager((tx) => loadDistribution(tx, { month: '2099-12', today: TODAY }))).toEqual([]);
  });
});

describe('previewDistribution', () => {
  it('добавляет случайный вариант и ничего не пишет', async () => {
    const s = await setup();
    const before = await placement(s.id);
    const [e] = await asManager((tx) => previewDistribution(tx, { eventId: s.id }, first));
    expect(e.rows.map((r) => r.workerId)).toEqual([s.anna, s.boris, s.vera]);
    // Всего 4 места не-АДМИН: все трое получают должность, ЗАЛ — не больше одного.
    expect(e.rows.every((r) => r.positionId !== null)).toBe(true);
    expect(e.rows.filter((r) => r.positionId === e.free[0].positionId).length).toBeLessThanOrEqual(1);
    expect(await placement(s.id)).toEqual(before);
  });
});

describe('applyDistribution', () => {
  it('ставит должности, не трогает расставленных, сохраняет личные ставки', async () => {
    const s = await setup();
    const [hall, tickets] = [await position('ЗАЛ'), await position('БИЛЕТЫ')];
    const result = await asManager((tx) => applyDistribution(tx, [
      { eventId: s.id, workerId: s.anna, positionId: hall },
      { eventId: s.id, workerId: s.boris, positionId: tickets },
      { eventId: s.id, workerId: s.vera, positionId: tickets },
    ]));
    expect(result).toEqual({ applied: 3, skipped: 0, eventIds: [s.id], months: ['2099-10'] });
    expect(await nameOf(s.id, s.anna)).toBe('ЗАЛ');
    expect(await nameOf(s.id, s.boris)).toBe('БИЛЕТЫ');
    expect(await nameOf(s.id, s.vera)).toBe('БИЛЕТЫ');
    expect(await nameOf(s.id, s.gleb)).toBe('ЗАЛ');
    expect(await nameOf(s.id, s.dina)).toBe('ВХОД');
    const rates = Object.fromEntries((await placement(s.id)).map((r) => [r.worker_id, r.rate]));
    expect(rates[s.vera]).toBe(1700);
    expect(rates[s.dina]).toBe(1500);
  });

  it('уведомления — как при обычной смене должности', async () => {
    const s = await setup();
    await testSql`delete from tg_event`;
    await asManager(async (tx) => applyDistribution(tx, [{ eventId: s.id, workerId: s.anna, positionId: await position('БИЛЕТЫ') }]));
    expect(await testSql`select kind, worker_id, event_id from tg_event`).toEqual([{ kind: 'assigned', worker_id: s.anna, event_id: s.id }]);
  });

  it('строки «без должности» ничего не делают и не считаются', async () => {
    const s = await setup();
    const before = await placement(s.id);
    expect(await asManager((tx) => applyDistribution(tx, [{ eventId: s.id, workerId: s.anna, positionId: null }])))
      .toEqual({ applied: 0, skipped: 0, eventIds: [], months: [] });
    expect(await asManager((tx) => applyDistribution(tx, []))).toEqual({ applied: 0, skipped: 0, eventIds: [], months: [] });
    expect(await placement(s.id)).toEqual(before);
  });

  it('пропускает АДМИН, превышение мест и должность без мест на мероприятии', async () => {
    const s = await setup();
    const [admin, hall, cash] = [await position('АДМИН'), await position('ЗАЛ'), await position('КАССА')];
    const result = await asManager((tx) => applyDistribution(tx, [
      { eventId: s.id, workerId: s.anna, positionId: admin },
      { eventId: s.id, workerId: s.boris, positionId: hall },
      { eventId: s.id, workerId: s.vera, positionId: hall },
      { eventId: s.id, workerId: s.anna, positionId: cash },
    ]));
    expect(result).toMatchObject({ applied: 1, skipped: 3 });
    expect(await nameOf(s.id, s.anna)).toBeNull();
    expect(await nameOf(s.id, s.boris)).toBe('ЗАЛ');
    expect(await nameOf(s.id, s.vera)).toBeNull();
  });

  it('пропускает изменившиеся строки: человека сняли, уже расставили, место заняли, отмена, архив', async () => {
    const s = await setup();
    const [hall, tickets] = [await position('ЗАЛ'), await position('БИЛЕТЫ')];
    const [eva, zhora] = [await worker('Ева'), await worker('Жора')];
    await assign(s.id, eva, null, { cancel: true });
    await assign(s.id, zhora, null);
    await testSql`update worker set status = 'archived' where id = ${zhora}`;
    // После предпросмотра: Анну сняли, Бориса поставили вручную, последнее место в ЗАЛЕ занял другой.
    await testSql`delete from assignment where worker_id = ${s.anna} and event_id = ${s.id}`;
    await testSql`update assignment set position_id = ${tickets} where worker_id = ${s.boris} and event_id = ${s.id}`;
    const late = await worker('Зина');
    await assign(s.id, late, 'ЗАЛ');
    const result = await asManager((tx) => applyDistribution(tx, [
      { eventId: s.id, workerId: s.anna, positionId: tickets },
      { eventId: s.id, workerId: s.boris, positionId: hall },
      { eventId: s.id, workerId: s.vera, positionId: hall },
      { eventId: s.id, workerId: eva, positionId: tickets },
      { eventId: s.id, workerId: zhora, positionId: tickets },
    ]));
    // Месяц — всё равно в итоге: таблицу нужно обновить, состав изменился.
    expect(result).toEqual({ applied: 0, skipped: 5, eventIds: [], months: ['2099-10'] });
    expect(await nameOf(s.id, s.boris)).toBe('БИЛЕТЫ');
    expect(await nameOf(s.id, s.vera)).toBeNull();
  });

  it('повтор строки одного человека — второй раз пропускается', async () => {
    const s = await setup();
    const [hall, tickets] = [await position('ЗАЛ'), await position('БИЛЕТЫ')];
    const result = await asManager((tx) => applyDistribution(tx, [
      { eventId: s.id, workerId: s.anna, positionId: tickets },
      { eventId: s.id, workerId: s.anna, positionId: hall },
    ]));
    expect(result).toMatchObject({ applied: 1, skipped: 1 });
    expect(await nameOf(s.id, s.anna)).toBe('БИЛЕТЫ');
  });

  it('человек с чужого мероприятия и неизвестное мероприятие — пропуск', async () => {
    const s = await setup();
    const other = await event('2099-10-18', { 'БИЛЕТЫ': 2 });
    const tickets = await position('БИЛЕТЫ');
    const result = await asManager((tx) => applyDistribution(tx, [
      { eventId: other, workerId: s.anna, positionId: tickets },
      { eventId: '00000000-0000-4000-8000-000000000000', workerId: s.anna, positionId: tickets },
    ]));
    expect(result).toMatchObject({ applied: 0, skipped: 2 });
    expect(await nameOf(s.id, s.anna)).toBeNull();
  });

  it('несколько мероприятий разных месяцев за раз', async () => {
    const a = await setup('2099-10-15');
    const b = await event('2099-11-02', { 'БИЛЕТЫ': 1 });
    await assign(b, a.gleb, null);
    const tickets = await position('БИЛЕТЫ');
    const result = await asManager((tx) => applyDistribution(tx, [
      { eventId: b, workerId: a.gleb, positionId: tickets },
      { eventId: a.id, workerId: a.anna, positionId: tickets },
    ]));
    expect(result.applied).toBe(2);
    expect([...result.eventIds].sort()).toEqual([a.id, b].sort());
    expect(result.months).toEqual(['2099-10', '2099-11']);
  });

  describe('гонка с assignWorker за последнее место', () => {
    const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
    async function lastSeat() {
      const id = await event('2099-10-15', { 'БИЛЕТЫ': 1 });
      const [anna, boris] = [await worker('Анна'), await worker('Борис')];
      await assign(id, anna, null);
      return { id, anna, boris, tickets: await position('БИЛЕТЫ') };
    }
    const tickets = async (id: string) => (await placement(id)).filter((r) => r.name === 'БИЛЕТЫ').map((r) => r.worker_id);

    it('распределение первым: ручная расстановка ждёт его и получает «мест нет»', async () => {
      const s = await lastSeat();
      let locked!: () => void;
      const holding = new Promise<void>((r) => { locked = r; });
      const distribution = asManager(async (tx) => {
        const result = await applyDistribution(tx, [{ eventId: s.id, workerId: s.anna, positionId: s.tickets }]);
        locked();
        await pause(300);
        return result;
      });
      await holding;
      const manual = asManager((tx) => assignWorker(tx, { eventId: s.id, workerId: s.boris, positionId: s.tickets }));
      expect(await distribution).toMatchObject({ applied: 1, skipped: 0 });
      await expect(manual).rejects.toThrow('На этой должности мест нет');
      expect(await tickets(s.id)).toEqual([s.anna]);
    });

    it('ручная расстановка первой: распределение ждёт её и пропускает строку', async () => {
      const s = await lastSeat();
      let locked!: () => void;
      const holding = new Promise<void>((r) => { locked = r; });
      const manual = asManager(async (tx) => {
        await assignWorker(tx, { eventId: s.id, workerId: s.boris, positionId: s.tickets });
        locked();
        await pause(300);
      });
      await holding;
      const distribution = asManager((tx) => applyDistribution(tx, [{ eventId: s.id, workerId: s.anna, positionId: s.tickets }]));
      await manual;
      expect(await distribution).toMatchObject({ applied: 0, skipped: 1 });
      expect(await tickets(s.id)).toEqual([s.boris]);
    });
  });

  it('два одновременных применения не занимают одно место дважды', async () => {
    const id = await event('2099-10-15', { 'БИЛЕТЫ': 1 });
    const [anna, boris] = [await worker('Анна'), await worker('Борис')];
    await assign(id, anna, null);
    await assign(id, boris, null);
    const tickets = await position('БИЛЕТЫ');
    const results = await Promise.all([
      asManager((tx) => applyDistribution(tx, [{ eventId: id, workerId: anna, positionId: tickets }])),
      asManager((tx) => applyDistribution(tx, [{ eventId: id, workerId: boris, positionId: tickets }])),
    ]);
    expect(results.map((r) => r.applied).sort()).toEqual([0, 1]);
    expect((await placement(id)).filter((r) => r.name === 'БИЛЕТЫ')).toHaveLength(1);
  });
});
