import { describe, it, expect, beforeEach } from 'vitest';
import { resetTestDb, testSql, asManager } from './setup';
import { ev } from './scheduleFixtures';
import {
  monthInfo, defaultBaseRates, createDraftMonth, publishMonth,
} from '@/lib/monthPlan/months';

beforeEach(async () => {
  await resetTestDb();
});

describe('monthInfo', () => {
  it('пустой месяц — без записи и событий', async () => {
    expect(await asManager((tx) => monthInfo(tx, '2099-07'))).toEqual({ status: null, events: 0 });
  });
});

describe('defaultBaseRates', () => {
  it('ставка последнего мероприятия того же типа из прошлых месяцев', async () => {
    await testSql`insert into event (event_date, start_time, tag, base_rate) values
      ('2099-05-10', '20:00', 'regular', 1200),
      ('2099-06-10', '20:00', 'regular', 1300),
      ('2099-06-11', '22:30', 'night', 2000),
      ('2099-06-12', '20:00', 'chapel', null),
      ('2099-07-01', '20:00', 'regular', 9999)`;
    const types = await testSql`select id,system_tag from event_type`;
    const ids = Object.fromEntries(types.map(t=>[t.system_tag,t.id]));
    expect(await asManager((tx) => defaultBaseRates(tx, '2099-07'))).toEqual({ [ids.regular]: 1300, [ids.night]: 2000 });
  });
});

describe('createDraftMonth', () => {
  it('создаёт черновик с мероприятиями, местами, автоприходом и ставкой по умолчанию', async () => {
    await testSql`insert into event (event_date, start_time, tag, base_rate) values ('2099-06-10', '22:30', 'night', 2000)`;
    await asManager((tx) => createDraftMonth(tx, '2099-07', [
      ev('2099-07-03', '20:00', 'Лунный свет', { comment: 'Запуск: 19:15' }),
      ev('2099-07-03', '22:30', 'Ночной орган', { tag: 'night' }),
    ]));
    expect(await asManager((tx) => monthInfo(tx, '2099-07'))).toEqual({ status: 'draft', events: 2 });
    const rows = await testSql`
      select to_char(start_time, 'HH24:MI') as start, to_char(arrive_time, 'HH24:MI') as arrive,
             arrive_manual, concert, source_title, tag::text as tag, base_rate, comment,
             (select sum(quantity)::int from event_slot s where s.event_id = e.id) as places
      from event e where event_date >= '2099-07-01' order by start_time`;
    expect(rows).toEqual([
      { start: '20:00', arrive: '18:00', arrive_manual: false, concert: 'Лунный свет', source_title: 'Лунный свет',
        tag: 'regular', base_rate: null, comment: 'Запуск: 19:15', places: 9 },
      { start: '22:30', arrive: '21:00', arrive_manual: false, concert: 'Ночной орган', source_title: 'Ночной орган',
        tag: 'night', base_rate: 2000, comment: null, places: 9 },
    ]);
  });

  it('пустой черновик', async () => {
    await asManager((tx) => createDraftMonth(tx, '2099-07', []));
    expect(await asManager((tx) => monthInfo(tx, '2099-07'))).toEqual({ status: 'draft', events: 0 });
  });

  it('месяц с мероприятиями второй раз не создаётся', async () => {
    await asManager((tx) => createDraftMonth(tx, '2099-07', [ev('2099-07-03', '20:00', 'А')]));
    await expect(asManager((tx) => createDraftMonth(tx, '2099-07', [ev('2099-07-04', '20:00', 'Б')])))
      .rejects.toThrow('Этот месяц уже создан — откройте его таблицу');
  });

  it('запись месяца без мероприятий снова становится черновиком', async () => {
    await testSql`insert into month (month, status, published_at) values ('2099-07', 'published', now())`;
    await asManager((tx) => createDraftMonth(tx, '2099-07', [ev('2099-07-03', '20:00', 'А')]));
    const [m] = await testSql`select status::text as status, published_at from month where month = '2099-07'`;
    expect(m).toEqual({ status: 'draft', published_at: null });
  });

  it('дата не из месяца — ошибка, ничего не создано', async () => {
    await expect(asManager((tx) => createDraftMonth(tx, '2099-07', [ev('2099-08-01', '20:00', 'А')])))
      .rejects.toThrow('Мероприятие не из этого месяца');
    const rows = await testSql`select 1 from month where month = '2099-07'`;
    expect(rows).toHaveLength(0);
  });
});

describe('publishMonth', () => {
  it('публикует черновик один раз', async () => {
    await asManager((tx) => createDraftMonth(tx, '2099-07', [ev('2099-07-03', '20:00', 'А')]));
    expect(await asManager((tx) => publishMonth(tx, '2099-07'))).toBe(1);
    const [m] = await testSql`select status::text as status, published_at is not null as dated from month`;
    expect(m).toEqual({ status: 'published', dated: true });
    await expect(asManager((tx) => publishMonth(tx, '2099-07'))).rejects.toThrow('Месяц уже опубликован');
  });
});
