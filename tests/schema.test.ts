import { describe, it, expect, beforeAll } from 'vitest';
import { resetTestDb, testSql, assertLocalTestDb } from './setup';

beforeAll(async () => {
  await resetTestDb();
});

describe('защита тестовой базы', () => {
  it('отказывается работать с удалённой базой', () => {
    expect(() => assertLocalTestDb('postgres://u:p@db.abc.supabase.co:5432/shift_test'))
      .toThrow(/только на локальной/);
  });

  it('отказывается работать с базой без суффикса _test', () => {
    expect(() => assertLocalTestDb('postgres://u:p@127.0.0.1:54322/postgres'))
      .toThrow(/только на локальной/);
  });

  it('пропускает локальную *_test', () => {
    expect(() => assertLocalTestDb('postgres://u:p@127.0.0.1:54322/shift_test')).not.toThrow();
  });
});

describe('схема', () => {
  it('заводит 7 должностей с шаблоном на 9 человек', async () => {
    const rows = await testSql`
      select name, default_quantity from position order by sort_order`;
    expect(rows.map((r) => r.name)).toEqual([
      'АДМИН', 'ЗАЛ', 'ВХОД В ЗАЛ', 'БИЛЕТЫ', 'БАЛКОН', 'ВХОД', 'КАССА',
    ]);
    expect(rows.reduce((sum, r) => sum + Number(r.default_quantity), 0)).toBe(9);
  });

  it('не даёт занять две должности на одном событии', async () => {
    const [w] = await testSql`
      insert into worker (full_name, name_key) values ('Тест', 'тест') returning id`;
    const [e] = await testSql`
      insert into event (event_date, start_time) values ('2026-07-09', '20:00') returning id`;
    const [p] = await testSql`select id from position where name = 'ЗАЛ'`;

    await testSql`insert into assignment (worker_id, event_id, position_id)
                  values (${w.id}, ${e.id}, ${p.id})`;
    await expect(
      testSql`insert into assignment (worker_id, event_id, position_id)
              values (${w.id}, ${e.id}, null)`,
    ).rejects.toThrow(/duplicate key/);
  });

  it('разрешает назначение без должности', async () => {
    const [w] = await testSql`
      insert into worker (full_name, name_key) values ('Без', 'без') returning id`;
    const [e] = await testSql`
      insert into event (event_date, start_time) values ('2026-07-11', '20:00') returning id`;
    await expect(
      testSql`insert into assignment (worker_id, event_id) values (${w.id}, ${e.id})`,
    ).resolves.toBeDefined();
  });

  it('не даёт два события в одну дату и время', async () => {
    await testSql`insert into event (event_date, start_time) values ('2026-07-10', '20:00')`;
    await expect(
      testSql`insert into event (event_date, start_time) values ('2026-07-10', '20:00')`,
    ).rejects.toThrow(/duplicate key/);
  });

  it('не принимает отрицательную ставку', async () => {
    await expect(
      testSql`insert into event (event_date, start_time, base_rate)
              values ('2026-07-12', '20:00', -1)`,
    ).rejects.toThrow(/check constraint/);
  });
});
