import { describe, it, expect, beforeEach } from 'vitest';
import { resetTestDb, testSql, asManager } from './setup';
import { applyImport, mergeStaff } from '@/lib/import/applyImport';
import { UserError } from '@/lib/errors';
import type { ParsedEvent } from '@/lib/import/parseSheet';

function ev(over: Partial<ParsedEvent> = {}): ParsedEvent {
  return {
    date: '2026-07-09', startTime: '20:00', arriveTime: '18:00',
    concert: 'Лунный свет', tag: 'regular', baseRate: 1300, rawRate: null, comment: null,
    staff: [
      { name: 'Ян Образцовый', position: 'АДМИН' },
      { name: 'Илья Примерный', position: null },
      { name: 'Артем Учебный', position: null },
      { name: 'Полина Фиктивная', position: 'КАССА' },
    ],
    ...over,
  };
}

async function staffOf(date = '2026-07-09') {
  return testSql`
    select w.full_name, p.name as position from assignment a
    join worker w on w.id = a.worker_id
    join event e on e.id = a.event_id
    left join position p on p.id = a.position_id
    where e.event_date = ${date}
    order by w.full_name`;
}

beforeEach(async () => {
  await resetTestDb();
});

describe('mergeStaff', () => {
  it('один человек дважды, у второго нет должности — заполняем, не конфликт', () => {
    expect(mergeStaff([
      { name: 'Кирилл Демонстрационный**', position: null },
      { name: 'Кирилл Демонстрационный', position: 'БИЛЕТЫ' },
    ])).toEqual({
      staff: [{ name: 'Кирилл Демонстрационный**', position: 'БИЛЕТЫ' }],
      conflicts: [],
    });
  });

  it('один человек дважды с разными должностями — остаётся поздняя, конфликт в отчёте', () => {
    expect(mergeStaff([
      { name: 'Илья Примерный', position: 'ЗАЛ' },
      { name: 'Илья Примерный', position: 'БИЛЕТЫ' },
    ])).toEqual({
      staff: [{ name: 'Илья Примерный', position: 'БИЛЕТЫ' }],
      conflicts: [{ name: 'Илья Примерный', kept: 'БИЛЕТЫ', dropped: 'ЗАЛ' }],
    });
  });

  it('та же должность дважды — не конфликт', () => {
    expect(mergeStaff([
      { name: 'Илья Примерный', position: 'ЗАЛ' },
      { name: 'Илья Примерный', position: 'ЗАЛ' },
    ])).toEqual({
      staff: [{ name: 'Илья Примерный', position: 'ЗАЛ' }],
      conflicts: [],
    });
  });

  it('null поверх должности — не конфликт, должность остаётся', () => {
    expect(mergeStaff([
      { name: 'Илья Примерный', position: 'ЗАЛ' },
      { name: 'Илья Примерный', position: null },
    ])).toEqual({
      staff: [{ name: 'Илья Примерный', position: 'ЗАЛ' }],
      conflicts: [],
    });
  });
});

describe('applyImport', () => {
  it('создаёт событие, людей и назначения с должностями', async () => {
    const summary = await asManager((tx) => applyImport(tx, [ev()]));
    expect(summary).toEqual({
      eventsCreated: 1, eventsUpdated: 0, workersCreated: 4, assignmentsCreated: 4, conflicts: [],
    });
    expect(await staffOf()).toEqual([
      { full_name: 'Артем Учебный', position: null },
      { full_name: 'Илья Примерный', position: null },
      { full_name: 'Полина Фиктивная', position: 'КАССА' },
      { full_name: 'Ян Образцовый', position: 'АДМИН' },
    ]);
  });

  it('приход из таблицы работников — ручной, без прихода — автоматический признак не ставится', async () => {
    await asManager((tx) => applyImport(tx, [
      ev({ date: '2026-07-20', startTime: '20:00', arriveTime: '18:00', staff: [] }),
      ev({ date: '2026-07-21', startTime: '20:00', arriveTime: null, staff: [] }),
    ]));
    const rows = await testSql`select arrive_manual from event order by event_date`;
    expect(rows.map((r) => r.arrive_manual)).toEqual([true, false]);
  });

  it('новое событие получает слоты из шаблона должностей', async () => {
    await asManager((tx) => applyImport(tx, [ev()]));
    const [{ total }] = await testSql`select sum(quantity)::int as total from event_slot`;
    expect(total).toBe(9);
  });

  it('повторный импорт не плодит дублей', async () => {
    await asManager((tx) => applyImport(tx, [ev()]));
    const second = await asManager((tx) => applyImport(tx, [ev()]));
    expect(second).toEqual({
      eventsCreated: 0, eventsUpdated: 1, workersCreated: 0, assignmentsCreated: 0, conflicts: [],
    });
    const [{ count }] = await testSql`select count(*)::int from event_slot`;
    expect(count).toBe(7);
  });

  it('лист позиций после основного расставляет людей', async () => {
    await asManager((tx) => applyImport(tx, [ev()]));
    await asManager((tx) => applyImport(tx, [ev({
      baseRate: null, concert: null,
      staff: [{ name: 'Илья Примерный', position: 'ЗАЛ' }],
    })]));
    expect(await staffOf()).toContainEqual({ full_name: 'Илья Примерный', position: 'ЗАЛ' });
    const [event] = await testSql`select concert, base_rate from event`;
    expect(event).toEqual({ concert: 'Лунный свет', base_rate: 1300 });
  });

  it('основной лист после листа позиций расстановку не стирает', async () => {
    await asManager((tx) => applyImport(tx, [ev({
      staff: [{ name: 'Илья Примерный', position: 'ЗАЛ' }],
    })]));
    const second = await asManager((tx) => applyImport(tx, [ev()]));
    expect(await staffOf()).toContainEqual({ full_name: 'Илья Примерный', position: 'ЗАЛ' });
    // null (не расставлен) поверх должности — не конфликт, ничего не теряется
    expect(second.conflicts).toEqual([]);
  });

  it('конфликт должностей в одной колонке — остаётся поздняя, конфликт в summary', async () => {
    const summary = await asManager((tx) => applyImport(tx, [ev({
      staff: [
        { name: 'Илья Примерный', position: 'ЗАЛ' },
        { name: 'Илья Примерный', position: 'БИЛЕТЫ' },
      ],
    })]));
    expect(summary.conflicts).toEqual([
      { date: '2026-07-09', startTime: '20:00', name: 'Илья Примерный', kept: 'БИЛЕТЫ', dropped: 'ЗАЛ' },
    ]);
    expect(await staffOf()).toContainEqual({ full_name: 'Илья Примерный', position: 'БИЛЕТЫ' });
  });

  it('лист позиций с другой должностью поверх уже расставленного — конфликт в summary', async () => {
    await asManager((tx) => applyImport(tx, [ev({
      staff: [{ name: 'Илья Примерный', position: 'ЗАЛ' }],
    })]));
    const second = await asManager((tx) => applyImport(tx, [ev({
      baseRate: null, concert: null,
      staff: [{ name: 'Илья Примерный', position: 'БАЛКОН' }],
    })]));
    expect(second.conflicts).toEqual([
      { date: '2026-07-09', startTime: '20:00', name: 'Илья Примерный', kept: 'БАЛКОН', dropped: 'ЗАЛ' },
    ]);
    expect(await staffOf()).toContainEqual({ full_name: 'Илья Примерный', position: 'БАЛКОН' });
  });

  it('склеивает варианты написания одного человека между событиями', async () => {
    await asManager((tx) => applyImport(tx, [
      ev({ staff: [{ name: 'Кирилл Демонстрационный**', position: null }] }),
      ev({ date: '2026-07-10', staff: [{ name: 'Демонстрационный Кирилл', position: null }] }),
    ]));
    const rows = await testSql`select id from worker where name_key = 'демонстрационный кирилл'`;
    expect(rows).toHaveLength(1);
  });

  it('битое событие откатывает всю пачку', async () => {
    await expect(
      asManager((tx) => applyImport(tx, [ev(), ev({ date: 'не-дата' })])),
    ).rejects.toThrow();
    const [{ count }] = await testSql`select count(*)::int from event`;
    expect(count).toBe(0);
  });

  it('неизвестная должность в справочнике — понятная UserError', async () => {
    const broken = ev({
      staff: [{ name: 'Илья Примерный', position: 'НЕТАКАЯ' as ParsedEvent['staff'][number]['position'] }],
    });
    await expect(asManager((tx) => applyImport(tx, [broken]))).rejects.toThrow(UserError);
    await expect(asManager((tx) => applyImport(tx, [broken])))
      .rejects.toThrow('В справочнике нет должности «НЕТАКАЯ»');
  });
});
