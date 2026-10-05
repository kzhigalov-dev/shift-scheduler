import { describe, it, expect, beforeEach } from 'vitest';
import { resetTestDb, testSql, asManager } from './setup';
import { UserError } from '@/lib/errors';
import {
  getEventCard, setSlot, assignWorker, unassignWorker, setPersonRate,
  acceptSignup, rejectSignup, resolveCancel,
} from '@/app/(manager)/event/[id]/operations';

let eventId: string; let hall: string; let balcony: string;
let ilya: string; let artem: string;

beforeEach(async () => {
  await resetTestDb();
  const [e] = await testSql`insert into event (event_date, start_time, base_rate)
    values ('2026-07-09', '20:00', 1300) returning id`;
  const [h] = await testSql`select id from position where name = 'ЗАЛ'`;
  const [b] = await testSql`select id from position where name = 'БАЛКОН'`;
  const [i] = await testSql`insert into worker (full_name, name_key)
    values ('Илья Примерный', 'илья примерный') returning id`;
  const [a] = await testSql`insert into worker (full_name, name_key)
    values ('Артем Учебный', 'артем учебный') returning id`;
  eventId = e.id; hall = h.id; balcony = b.id; ilya = i.id; artem = a.id;
  await testSql`insert into event_slot (event_id, position_id, quantity) values
    (${eventId}, ${hall}, 1), (${eventId}, ${balcony}, 2)`;
});

const positionOf = async (workerId: string) =>
  (await testSql`select position_id from assignment where worker_id = ${workerId}`)[0]?.position_id;

describe('расстановка', () => {
  it('ставит на должность', async () => {
    await asManager((tx) => assignWorker(tx, { eventId, workerId: ilya, positionId: hall }));
    expect(await positionOf(ilya)).toBe(hall);
  });

  it('перестановка меняет должность, а не плодит строку', async () => {
    await asManager((tx) => assignWorker(tx, { eventId, workerId: ilya, positionId: hall }));
    await asManager((tx) => assignWorker(tx, { eventId, workerId: ilya, positionId: balcony }));
    const rows = await testSql`select id from assignment where worker_id = ${ilya}`;
    expect(rows).toHaveLength(1);
    expect(await positionOf(ilya)).toBe(balcony);
  });

  it('не пускает сверх количества мест', async () => {
    await asManager((tx) => assignWorker(tx, { eventId, workerId: ilya, positionId: hall }));
    await expect(
      asManager((tx) => assignWorker(tx, { eventId, workerId: artem, positionId: hall })),
    ).rejects.toThrow(/мест нет/);
  });

  it('должность без слота на событии — мест нет', async () => {
    const [cash] = await testSql`select id from position where name = 'КАССА'`;
    await expect(
      asManager((tx) => assignWorker(tx, { eventId, workerId: ilya, positionId: cash.id })),
    ).rejects.toThrow(/мест нет/);
  });

  it('работника из архива назначить нельзя — ни на должность, ни «не расставлен»', async () => {
    await testSql`update worker set status = 'archived' where id = ${ilya}`;
    for (const positionId of [hall, null]) {
      await expect(
        asManager((tx) => assignWorker(tx, { eventId, workerId: ilya, positionId })),
      ).rejects.toThrow(new UserError('Работник в архиве'));
    }
    expect(await testSql`select id from assignment`).toHaveLength(0);
  });

  it('«не расставлен» не ограничен', async () => {
    await asManager((tx) => assignWorker(tx, { eventId, workerId: ilya, positionId: null }));
    await asManager((tx) => assignWorker(tx, { eventId, workerId: artem, positionId: null }));
    const rows = await testSql`select id from assignment where position_id is null`;
    expect(rows).toHaveLength(2);
  });

  it('снятие освобождает место', async () => {
    await asManager((tx) => assignWorker(tx, { eventId, workerId: ilya, positionId: hall }));
    await asManager((tx) => unassignWorker(tx, { eventId, workerId: ilya }));
    await expect(
      asManager((tx) => assignWorker(tx, { eventId, workerId: artem, positionId: hall })),
    ).resolves.toBeUndefined();
  });

  it('снятие удаляет и заявку на это событие — иначе она протухает как «принята»', async () => {
    const [s] = await testSql`insert into signup (worker_id, event_id, status)
      values (${ilya}, ${eventId}, 'accepted') returning id`;
    await asManager((tx) => assignWorker(tx, { eventId, workerId: ilya, positionId: hall }));
    await asManager((tx) => unassignWorker(tx, { eventId, workerId: ilya }));
    expect(await testSql`select id from signup where id = ${s.id}`).toHaveLength(0);
  });

  it('двое одновременно не занимают последнее место', async () => {
    // Первая транзакция занимает место и держит блокировку 300 мс.
    const first = asManager(async (tx) => {
      await assignWorker(tx, { eventId, workerId: ilya, positionId: hall });
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const second = asManager((tx) =>
      assignWorker(tx, { eventId, workerId: artem, positionId: hall }));

    const results = await Promise.allSettled([first, second]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
    const rows = await testSql`select worker_id from assignment where position_id = ${hall}`;
    expect(rows.map((r) => r.worker_id)).toEqual([ilya]);
  });
});

describe('ставки', () => {
  it('ставка должности на концерте и личная ставка сохраняются', async () => {
    await asManager((tx) => setSlot(tx, { eventId, positionId: hall, quantity: 2, rate: 1800 }));
    await asManager((tx) => assignWorker(tx, { eventId, workerId: ilya, positionId: hall }));
    await asManager((tx) => setPersonRate(tx, { eventId, workerId: ilya, rate: 2400 }));
    const card = await asManager((tx) => getEventCard(tx, eventId));
    const slot = card?.slots.find((s) => s.name === 'ЗАЛ');
    expect(slot).toMatchObject({ quantity: 2, rate: 1800 });
    expect(slot?.people).toEqual([
      { workerId: ilya, fullName: 'Илья Примерный', personRate: 2400, cancelRequested: false },
    ]);
  });

  it('количество мест — целое от 0 до MAX_DEFAULT_QUANTITY', async () => {
    for (const quantity of [21, 100_000_000, -1, 1.5, Number.NaN]) {
      await expect(
        asManager((tx) => setSlot(tx, { eventId, positionId: hall, quantity, rate: null })),
      ).rejects.toThrow(UserError);
    }
    await asManager((tx) => setSlot(tx, { eventId, positionId: hall, quantity: 20, rate: null }));
    const [row] = await testSql`select quantity from event_slot
      where event_id = ${eventId} and position_id = ${hall}`;
    expect(row.quantity).toBe(20);
  });

  it('слот можно обнулить, ставку — сбросить', async () => {
    await asManager((tx) => setSlot(tx, { eventId, positionId: hall, quantity: 0, rate: null }));
    const [row] = await testSql`select quantity, rate from event_slot
      where event_id = ${eventId} and position_id = ${hall}`;
    expect(row).toEqual({ quantity: 0, rate: null });
  });
});

describe('заявки и отмены', () => {
  it('принятие заявки создаёт назначение, повторное — ошибка', async () => {
    const [s] = await testSql`insert into signup (worker_id, event_id)
      values (${ilya}, ${eventId}) returning id`;
    await asManager((tx) => acceptSignup(tx, { signupId: s.id, positionId: null }));
    const [signup] = await testSql`select status from signup where id = ${s.id}`;
    expect(signup.status).toBe('accepted');
    expect(await testSql`select id from assignment where worker_id = ${ilya}`).toHaveLength(1);
    await expect(
      asManager((tx) => acceptSignup(tx, { signupId: s.id, positionId: null })),
    ).rejects.toThrow(/уже обработана/);
  });

  it('отклонение заявки', async () => {
    const [s] = await testSql`insert into signup (worker_id, event_id)
      values (${ilya}, ${eventId}) returning id`;
    await asManager((tx) => rejectSignup(tx, s.id));
    const [signup] = await testSql`select status from signup where id = ${s.id}`;
    expect(signup.status).toBe('rejected');
  });

  it('одобренная отмена снимает человека и его заявку', async () => {
    await testSql`insert into signup (worker_id, event_id, status)
      values (${ilya}, ${eventId}, 'accepted')`;
    await testSql`insert into assignment (worker_id, event_id, cancel_requested_at)
      values (${ilya}, ${eventId}, now())`;
    await asManager((tx) => resolveCancel(tx, { eventId, workerId: ilya, approve: true }));
    expect(await testSql`select id from assignment`).toHaveLength(0);
    expect(await testSql`select id from signup`).toHaveLength(0);
  });

  it('одобрение — только строго true: строка "false" из браузера не снимает человека', async () => {
    await testSql`insert into assignment (worker_id, event_id, cancel_requested_at)
      values (${ilya}, ${eventId}, now())`;
    // Аргументы action приходят из браузера: тип boolean там не гарантирован.
    const approve = 'false' as unknown as boolean;
    await asManager((tx) => resolveCancel(tx, { eventId, workerId: ilya, approve }));
    const rows = await testSql`select cancel_requested_at from assignment where worker_id = ${ilya}`;
    expect(rows).toHaveLength(1);
    expect(rows[0].cancel_requested_at).toBeNull();
  });

  it('отклонённая отмена снимает только отметку', async () => {
    await testSql`insert into assignment (worker_id, event_id, cancel_requested_at)
      values (${ilya}, ${eventId}, now())`;
    await asManager((tx) => resolveCancel(tx, { eventId, workerId: ilya, approve: false }));
    const [row] = await testSql`select cancel_requested_at from assignment`;
    expect(row.cancel_requested_at).toBeNull();
  });
});

describe('честные ошибки при гонке — вместо тихого успеха', () => {
  it('unassignWorker — человека уже нет на событии', async () => {
    await expect(
      asManager((tx) => unassignWorker(tx, { eventId, workerId: artem })),
    ).rejects.toThrow(/уже нет на этом событии/);
  });

  it('setPersonRate — человека уже нет на событии', async () => {
    await expect(
      asManager((tx) => setPersonRate(tx, { eventId, workerId: artem, rate: 1500 })),
    ).rejects.toThrow(/уже нет на этом событии/);
  });

  it('resolveCancel(approve: true) — человека уже нет на событии', async () => {
    await expect(
      asManager((tx) => resolveCancel(tx, { eventId, workerId: artem, approve: true })),
    ).rejects.toThrow(/уже нет на этом событии/);
  });

  it('resolveCancel(approve: false) — человека уже нет на событии', async () => {
    await expect(
      asManager((tx) => resolveCancel(tx, { eventId, workerId: artem, approve: false })),
    ).rejects.toThrow(/уже нет на этом событии/);
  });

  it('rejectSignup — повторное отклонение уже обработанной заявки', async () => {
    const [s] = await testSql`insert into signup (worker_id, event_id)
      values (${ilya}, ${eventId}) returning id`;
    await asManager((tx) => rejectSignup(tx, s.id));
    await expect(
      asManager((tx) => rejectSignup(tx, s.id)),
    ).rejects.toThrow(/уже обработана/);
  });
});

describe('getEventCard', () => {
  it('собирает должности по порядку, не расставленных, заявки и свободных людей', async () => {
    const [p] = await testSql`insert into worker (full_name, name_key)
      values ('Полина Фиктивная', 'полина фиктивная') returning id`;
    await testSql`insert into assignment (worker_id, event_id) values (${ilya}, ${eventId})`;
    await testSql`insert into signup (worker_id, event_id) values (${artem}, ${eventId})`;

    const card = await asManager((tx) => getEventCard(tx, eventId));
    expect(card?.event).toMatchObject({ date: '2026-07-09', startTime: '20:00', baseRate: 1300 });
    expect(card?.slots.map((s) => s.name)).toEqual([
      'АДМИН', 'ЗАЛ', 'ВХОД В ЗАЛ', 'БИЛЕТЫ', 'БАЛКОН', 'ВХОД', 'КАССА',
    ]);
    expect(card?.slots.find((s) => s.name === 'АДМИН')?.quantity).toBe(0);
    expect(card?.unplaced.map((u) => u.fullName)).toEqual(['Илья Примерный']);
    expect(card?.signups.map((s) => s.fullName)).toEqual(['Артем Учебный']);
    expect(card?.available.map((w) => w.id)).toEqual(expect.arrayContaining([artem, p.id]));
    expect(card?.available.map((w) => w.id)).not.toContain(ilya);
  });

  it('несуществующее событие — null', async () => {
    expect(await asManager((tx) =>
      getEventCard(tx, '00000000-0000-0000-0000-000000000000'))).toBeNull();
  });
});
