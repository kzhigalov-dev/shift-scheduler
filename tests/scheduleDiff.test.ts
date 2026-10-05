import { describe, it, expect, beforeEach } from 'vitest';
import { resetTestDb, testSql, asManager } from './setup';
import { ev } from './scheduleFixtures';
import { diffSchedule, type ExistingEvent } from '@/lib/schedule/diff';
import { createDraftMonth, existingForDiff, applyScheduleDiff } from '@/lib/monthPlan/months';

const ex = (id: string, date: string, startTime: string, sourceTitle: string | null, people = 0): ExistingEvent =>
  ({ id, date, startTime, sourceTitle, people });

describe('diffSchedule', () => {
  it('без изменений — только счётчик', () => {
    const d = diffSchedule([ex('a', '2099-07-03', '20:00', 'Лунный свет')], [ev('2099-07-03', '20:00', 'лунный  свет')]);
    expect(d).toEqual({ added: [], changed: [], missing: [], unchanged: 1 });
  });

  it('новое мероприятие', () => {
    const incoming = ev('2099-07-04', '20:00', 'Новое');
    expect(diffSchedule([], [incoming]).added).toEqual([incoming]);
  });

  it('сдвинули время — узнаётся по дате и названию', () => {
    const d = diffSchedule([ex('a', '2099-07-03', '20:00', 'Лунный свет')], [ev('2099-07-03', '19:30', 'Лунный свет')]);
    expect(d.changed).toEqual([{
      eventId: 'a', before: { startTime: '20:00', title: 'Лунный свет' }, after: ev('2099-07-03', '19:30', 'Лунный свет'),
    }]);
    expect(d.added).toEqual([]);
    expect(d.missing).toEqual([]);
  });

  it('поменяли название — узнаётся по дате и началу', () => {
    const d = diffSchedule([ex('a', '2099-07-03', '20:00', 'Лунный свет')], [ev('2099-07-03', '20:00', 'Вечный Бах')]);
    expect(d.changed.map((c) => [c.eventId, c.before.title, c.after.title])).toEqual([['a', 'Лунный свет', 'Вечный Бах']]);
  });

  it('пропало из расписания — с числом людей; созданное вручную не пропадает', () => {
    const d = diffSchedule([
      ex('a', '2099-07-03', '20:00', 'Лунный свет', 3),
      ex('m', '2099-07-05', '20:00', null),
    ], []);
    expect(d.missing).toEqual([{ eventId: 'a', date: '2099-07-03', startTime: '20:00', title: 'Лунный свет', people: 3 }]);
  });

  it('созданное вручную на то же время — без изменений', () => {
    const d = diffSchedule([ex('m', '2099-07-05', '20:00', null)], [ev('2099-07-05', '20:00', 'Из файла')]);
    expect(d).toEqual({ added: [], changed: [], missing: [], unchanged: 1 });
  });

  it('проблемные строки не участвуют', () => {
    const d = diffSchedule([], [ev('2099-07-06', '', 'Без времени', { issue: 'Нет времени начала', key: 'row:9:0' })]);
    expect(d).toEqual({ added: [], changed: [], missing: [], unchanged: 0 });
  });
});

describe('applyScheduleDiff', () => {
  beforeEach(async () => {
    await resetTestDb();
    await asManager((tx) => createDraftMonth(tx, '2099-07', [
      ev('2099-07-03', '20:00', 'Лунный свет'),
      ev('2099-07-04', '20:00', 'Голос Диснея'),
      ev('2099-07-05', '20:00', 'Снятое'),
    ]));
  });

  const events = async () => testSql`
    select to_char(event_date, 'MM-DD') as day, to_char(start_time, 'HH24:MI') as start,
           to_char(arrive_time, 'HH24:MI') as arrive, arrive_manual, concert, source_title
    from event order by event_date, start_time`;

  it('добавляет, меняет и удаляет только отмеченное', async () => {
    await testSql`update event set arrive_time = '17:00', arrive_manual = true where source_title = 'Голос Диснея'`;
    await testSql`update event set concert = 'Переименовал менеджер' where source_title = 'Голос Диснея'`;
    const [w] = await testSql`insert into worker (full_name, name_key) values ('Ян', 'ян') returning id`;
    const [e] = await testSql`select id from event where source_title = 'Лунный свет'`;
    await testSql`insert into assignment (worker_id, event_id) values (${w.id}, ${e.id})`;

    const incoming = [
      ev('2099-07-03', '19:30', 'Лунный свет'),
      ev('2099-07-04', '19:00', 'Голос Диснея'),
      ev('2099-07-10', '20:00', 'Новое А'),
      ev('2099-07-11', '20:00', 'Новое Б'),
    ];
    const summary = await asManager(async (tx) => {
      const diff = diffSchedule(await existingForDiff(tx, '2099-07'), incoming);
      expect(diff.missing.map((m) => m.title)).toEqual(['Снятое']);
      const snatched = diff.missing[0].eventId;
      return applyScheduleDiff(tx, '2099-07', diff, {
        add: ['2099-07-10|20:00'],
        change: diff.changed.map((c) => c.eventId),
        remove: [snatched],
      });
    });
    expect(summary).toEqual({ added: 1, changed: 2, removed: 1 });
    expect(await events()).toEqual([
      { day: '07-03', start: '19:30', arrive: '17:30', arrive_manual: false, concert: 'Лунный свет', source_title: 'Лунный свет' },
      { day: '07-04', start: '19:00', arrive: '17:00', arrive_manual: true, concert: 'Переименовал менеджер', source_title: 'Голос Диснея' },
      { day: '07-10', start: '20:00', arrive: '18:00', arrive_manual: false, concert: 'Новое А', source_title: 'Новое А' },
    ]);
    const people = await testSql`select 1 from assignment`;
    expect(people).toHaveLength(1);
  });

  it('изменённое: ручные тип и комментарий сохраняются, приход считается по сохранённому типу', async () => {
    await testSql`update event set start_time = '22:30', arrive_time = '21:00', arrive_manual = false,
      tag = 'night', comment = 'Ключи у вахтёра' where source_title = 'Лунный свет'`;
    const summary = await asManager(async (tx) => {
      const diff = diffSchedule(await existingForDiff(tx, '2099-07'), [
        ev('2099-07-03', '22:00', 'Лунный свет', { comment: 'из файла' }),
        ev('2099-07-04', '20:00', 'Голос Диснея'),
        ev('2099-07-05', '20:00', 'Снятое'),
      ]);
      expect(diff.changed).toHaveLength(1);
      return applyScheduleDiff(tx, '2099-07', diff, { add: [], change: diff.changed.map((c) => c.eventId), remove: [] });
    });
    expect(summary).toEqual({ added: 0, changed: 1, removed: 0 });
    const [row] = await testSql`
      select to_char(start_time, 'HH24:MI') as start, to_char(arrive_time, 'HH24:MI') as arrive,
             arrive_manual, tag::text as tag, comment
      from event where source_title = 'Лунный свет'`;
    expect(row).toEqual({ start: '22:00', arrive: '20:30', arrive_manual: false, tag: 'night', comment: 'Ключи у вахтёра' });
  });

  it('existingForDiff считает людей', async () => {
    const [w] = await testSql`insert into worker (full_name, name_key) values ('Ян', 'ян') returning id`;
    const [e] = await testSql`select id from event where source_title = 'Снятое'`;
    await testSql`insert into assignment (worker_id, event_id) values (${w.id}, ${e.id})`;
    const rows = await asManager((tx) => existingForDiff(tx, '2099-07'));
    expect(rows.map((r) => [r.sourceTitle, r.people])).toEqual([['Лунный свет', 0], ['Голос Диснея', 0], ['Снятое', 1]]);
  });

  it('событие, созданное вручную, не удаляется даже если id передали', async () => {
    const [m] = await testSql`insert into event (event_date, start_time) values ('2099-07-20', '20:00') returning id`;
    await asManager((tx) => applyScheduleDiff(tx, '2099-07',
      { added: [], changed: [], missing: [{ eventId: m.id, date: '2099-07-20', startTime: '20:00', title: '', people: 0 }], unchanged: 0 },
      { add: [], change: [], remove: [m.id] }));
    const rows = await testSql`select 1 from event where id = ${m.id}`;
    expect(rows).toHaveLength(1);
  });
});
