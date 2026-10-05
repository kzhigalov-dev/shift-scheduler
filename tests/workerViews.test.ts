import { describe, it, expect, beforeEach } from 'vitest';
import { resetTestDb, testSql, asWorker, asManager } from './setup';
import {
  myShifts, availableEvents, createSignup, withdrawSignup, requestCancel, myEarnings,
  monthShifts, monthAvailable,
} from '@/app/(worker)/queries';
import { acceptSignup, unassignWorker } from '@/app/(manager)/event/[id]/operations';

let ilya: string; let artem: string; let past: string; let future: string; let later: string;
let hall: string;

beforeEach(async () => {
  await resetTestDb();
  const [w] = await testSql`insert into worker (full_name, name_key) values ('Илья', 'илья') returning id`;
  const [a] = await testSql`insert into worker (full_name, name_key) values ('Артем', 'артем') returning id`;
  const [p] = await testSql`insert into event (event_date, start_time, base_rate, concert)
    values ('2020-01-10', '20:00', 1000, 'Старый') returning id`;
  const [f] = await testSql`insert into event (event_date, start_time, arrive_time, base_rate, concert)
    values ('2099-01-01', '20:00', '18:00', 1300, 'Будущий') returning id`;
  const [l] = await testSql`insert into event (event_date, start_time, base_rate)
    values ('2099-02-01', '20:00', 1300) returning id`;
  const [h] = await testSql`select id from position where name = 'ЗАЛ'`;
  ilya = w.id; artem = a.id; past = p.id; future = f.id; later = l.id; hall = h.id;
  await testSql`insert into event_slot (event_id, position_id, quantity, rate)
    values (${future}, ${hall}, 1, 1800)`;
  await testSql`insert into assignment (worker_id, event_id, position_id, rate)
    values (${ilya}, ${past}, null, 2400)`;
  await testSql`insert into assignment (worker_id, event_id, position_id)
    values (${ilya}, ${future}, ${hall})`;
  await testSql`insert into assignment (worker_id, event_id) values (${artem}, ${later})`;
});

describe('мои смены', () => {
  it('только будущие, со ставкой должности на концерте', async () => {
    expect(await asWorker(ilya, (tx) => myShifts(tx, ilya))).toEqual([{
      eventId: future, date: '2099-01-01', startTime: '20:00', arriveTime: '18:00',
      concert: 'Будущий', position: 'ЗАЛ', amount: 1800, cancelRequested: false,
    }]);
  });

  it('запрос отмены ставит отметку, повторный — ошибка', async () => {
    await asWorker(ilya, (tx) => requestCancel(tx, future));
    const [shift] = await asWorker(ilya, (tx) => myShifts(tx, ilya));
    expect(shift.cancelRequested).toBe(true);
    await expect(asWorker(ilya, (tx) => requestCancel(tx, future))).rejects.toThrow(/уже/);
  });

  it('чужие смены не видны, даже если передать чужой id', async () => {
    expect(await asWorker(ilya, (tx) => myShifts(tx, artem))).toEqual([]);
  });
});

describe('свободные события', () => {
  it('будущие, где ещё не назначен', async () => {
    const rows = await asWorker(ilya, (tx) => availableEvents(tx, ilya));
    expect(rows.map((r) => r.eventId)).toEqual([later]);
  });

  it('заявка появляется и отзывается', async () => {
    await asWorker(ilya, (tx) => createSignup(tx, { workerId: ilya, eventId: later }));
    let [row] = await asWorker(ilya, (tx) => availableEvents(tx, ilya));
    expect(row.signupStatus).toBe('pending');
    await asWorker(ilya, (tx) => withdrawSignup(tx, { workerId: ilya, eventId: later }));
    [row] = await asWorker(ilya, (tx) => availableEvents(tx, ilya));
    expect(row.signupStatus).toBeNull();
  });

  it('повторная заявка не создаёт вторую строку', async () => {
    await asWorker(ilya, (tx) => createSignup(tx, { workerId: ilya, eventId: later }));
    await asWorker(ilya, (tx) => createSignup(tx, { workerId: ilya, eventId: later }));
    const [{ count }] = await testSql`select count(*)::int from signup`;
    expect(count).toBe(1);
  });

  it('принятую заявку отозвать нельзя', async () => {
    await testSql`insert into signup (worker_id, event_id, status)
      values (${ilya}, ${later}, 'accepted')`;
    await expect(asWorker(ilya, (tx) =>
      withdrawSignup(tx, { workerId: ilya, eventId: later }))).rejects.toThrow(/Не смогу/);
  });

  it('отклонённую заявку отозвать нельзя — уже отклонена', async () => {
    await testSql`insert into signup (worker_id, event_id, status)
      values (${ilya}, ${later}, 'rejected')`;
    await expect(asWorker(ilya, (tx) =>
      withdrawSignup(tx, { workerId: ilya, eventId: later }))).rejects.toThrow(/отклонили/);
  });

  it('отозвать несуществующую заявку — обновите страницу', async () => {
    await expect(asWorker(ilya, (tx) =>
      withdrawSignup(tx, { workerId: ilya, eventId: later }))).rejects.toThrow(/обновите страницу/);
  });
});

describe('заявка — защита в глубину', () => {
  it('прошедшее событие — отказ', async () => {
    await expect(asWorker(ilya, (tx) =>
      createSignup(tx, { workerId: ilya, eventId: past }))).rejects.toThrow(/прошло/);
  });

  it('уже назначен на событие — отказ, заявка не создаётся', async () => {
    await expect(asWorker(ilya, (tx) =>
      createSignup(tx, { workerId: ilya, eventId: future }))).rejects.toThrow(/уже/);
    const rows = await testSql`select id from signup
      where worker_id = ${ilya} and event_id = ${future}`;
    expect(rows).toHaveLength(0);
  });

  it('отклонённую заявку нельзя подать повторно, статус остаётся rejected', async () => {
    await testSql`insert into signup (worker_id, event_id, status)
      values (${ilya}, ${later}, 'rejected')`;
    await expect(asWorker(ilya, (tx) =>
      createSignup(tx, { workerId: ilya, eventId: later }))).rejects.toThrow(/отклонили/);
    const [row] = await testSql`select status from signup
      where worker_id = ${ilya} and event_id = ${later}`;
    expect(row.status).toBe('rejected');
  });
});

describe('принята, но снят — заявка не должна протухать', () => {
  it('после unassign доступно снова: availableEvents — null, новая заявка — pending', async () => {
    const [event] = await testSql`insert into event (event_date, start_time, base_rate)
      values ('2099-03-01', '20:00', 1300) returning id`;
    const [s] = await testSql`insert into signup (worker_id, event_id)
      values (${ilya}, ${event.id}) returning id`;
    await asManager((tx) => acceptSignup(tx, { signupId: s.id, positionId: null }));
    await asManager((tx) => unassignWorker(tx, { eventId: event.id, workerId: ilya }));

    const available = await asWorker(ilya, (tx) => availableEvents(tx, ilya));
    expect(available.find((r) => r.eventId === event.id)?.signupStatus).toBeNull();

    await asWorker(ilya, (tx) => createSignup(tx, { workerId: ilya, eventId: event.id }));
    const [row] = await testSql`select status from signup
      where worker_id = ${ilya} and event_id = ${event.id}`;
    expect(row.status).toBe('pending');
  });
});

describe('сегодня по Москве', () => {
  it('сегодняшнее (по Москве) событие видно и в свободных, и в моих сменах', async () => {
    const [today] = await testSql`insert into event (event_date, start_time, base_rate)
      values ((now() at time zone 'Europe/Moscow')::date, '20:00', 1300) returning id`;

    const available = await asWorker(ilya, (tx) => availableEvents(tx, ilya));
    expect(available.map((r) => r.eventId)).toContain(today.id);

    await testSql`insert into assignment (worker_id, event_id) values (${ilya}, ${today.id})`;
    const shifts = await asWorker(ilya, (tx) => myShifts(tx, ilya));
    expect(shifts.map((s) => s.eventId)).toContain(today.id);
  });
});

describe('заработок', () => {
  it('за месяц, с личной ставкой', async () => {
    expect(await asWorker(ilya, (tx) => myEarnings(tx, ilya, '2020-01'))).toEqual({
      shifts: 1, total: 2400, unpriced: 0,
      items: [{ date: '2020-01-10', concert: 'Старый', position: null, amount: 2400 }],
    });
  });

  it('пустой месяц', async () => {
    expect(await asWorker(ilya, (tx) => myEarnings(tx, ilya, '2020-02')))
      .toEqual({ shifts: 0, total: 0, unpriced: 0, items: [] });
  });

  it('чужой id под своей сессией — пусто', async () => {
    expect(await asWorker(ilya, (tx) => myEarnings(tx, artem, '2099-02')))
      .toEqual({ shifts: 0, total: 0, unpriced: 0, items: [] });
  });

  it('уровни 3 и 4 (ставка должности по умолчанию, ставка концерта) и смена без ставки', async () => {
    await testSql`update position set default_rate = 900 where name = 'БАЛКОН'`;
    const [balcony] = await testSql`select id from position where name = 'БАЛКОН'`;
    const [zal] = await testSql`select id from position where name = 'ЗАЛ'`;

    const [eLevel3] = await testSql`insert into event (event_date, start_time, concert)
      values ('2030-05-01', '20:00', 'Уровень 3') returning id`;
    const [eLevel4] = await testSql`insert into event (event_date, start_time, base_rate, concert)
      values ('2030-05-02', '20:00', 1500, 'Уровень 4') returning id`;
    const [eNull] = await testSql`insert into event (event_date, start_time, concert)
      values ('2030-05-03', '20:00', 'Без ставки') returning id`;

    await testSql`insert into assignment (worker_id, event_id, position_id)
      values (${ilya}, ${eLevel3.id}, ${balcony.id})`;
    await testSql`insert into assignment (worker_id, event_id, position_id)
      values (${ilya}, ${eLevel4.id}, ${zal.id})`;
    await testSql`insert into assignment (worker_id, event_id)
      values (${ilya}, ${eNull.id})`;

    const earnings = await asWorker(ilya, (tx) => myEarnings(tx, ilya, '2030-05'));
    expect(earnings).toEqual({
      shifts: 3, total: 900 + 1500, unpriced: 1,
      items: [
        { date: '2030-05-01', concert: 'Уровень 3', position: 'БАЛКОН', amount: 900 },
        { date: '2030-05-02', concert: 'Уровень 4', position: 'ЗАЛ', amount: 1500 },
        { date: '2030-05-03', concert: 'Без ставки', position: null, amount: null },
      ],
    });
  });
});

describe('месяц сеткой', () => {
  it('monthShifts — все свои смены месяца, включая прошедшие, без смен других месяцев', async () => {
    const [second] = await testSql`insert into event (event_date, start_time, base_rate)
      values ('2020-01-25', '19:00', 1000) returning id`;
    const [otherMonth] = await testSql`insert into event (event_date, start_time, base_rate)
      values ('2020-02-01', '19:00', 1000) returning id`;
    await testSql`insert into assignment (worker_id, event_id) values (${ilya}, ${second.id})`;
    await testSql`insert into assignment (worker_id, event_id) values (${ilya}, ${otherMonth.id})`;

    const past2020 = await asWorker(ilya, (tx) => monthShifts(tx, ilya, '2020-01'));
    expect(past2020.map((s) => s.eventId)).toEqual([past, second.id]);
    expect(past2020[0]).toMatchObject({ date: '2020-01-10', amount: 2400 });

    const future2099 = await asWorker(ilya, (tx) => monthShifts(tx, ilya, '2099-01'));
    expect(future2099.map((s) => s.eventId)).toEqual([future]);
  });

  it('monthShifts — чужие смены не видны, даже если передать чужой id', async () => {
    expect(await asWorker(ilya, (tx) => monthShifts(tx, artem, '2099-02'))).toEqual([]);
  });

  it('monthAvailable — только будущие свободные события этого месяца', async () => {
    const [otherMonth] = await testSql`insert into event (event_date, start_time, base_rate)
      values ('2099-03-01', '20:00', 1300) returning id`;
    await testSql`insert into event (event_date, start_time, base_rate)
      values ('2020-01-15', '20:00', 1000)`;

    const feb = await asWorker(ilya, (tx) => monthAvailable(tx, ilya, '2099-02'));
    expect(feb.map((e) => e.eventId)).toEqual([later]);
    expect(feb.map((e) => e.eventId)).not.toContain(otherMonth.id);

    // Свои смены месяца (2099-01) в свободных не показываются.
    expect(await asWorker(ilya, (tx) => monthAvailable(tx, ilya, '2099-01'))).toEqual([]);
    // Прошедший месяц: свободное событие есть, но уже прошло.
    expect(await asWorker(ilya, (tx) => monthAvailable(tx, ilya, '2020-01'))).toEqual([]);
  });
});
