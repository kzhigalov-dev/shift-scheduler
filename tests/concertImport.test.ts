import { getEventCard } from '@/app/(manager)/event/[id]/operations';
import { describe, expect, it } from 'vitest';
import { parseConcerts } from '@/lib/concerts/parseConcerts';
import type { WorkbookSheet } from '@/lib/import/workbook';

const table = (rows: WorkbookSheet['rows']): WorkbookSheet[] => [{ name: '2026', rows: [
  ['дата', 'название', 'время', 'артисты', 'описание', 'программа'], ...rows,
] }];

describe('программы концертов', () => {
  it('берёт программу из описания и сохраняет весь текст исполнителей', () => {
    expect(parseConcerts(table([['06.10.2026', 'Лики любви', '20:00', 'Ансамбль\nОрган', 'Бах\nГлинка', 'не брать']]), '2026-10')[0])
      .toMatchObject({ date: '2026-10-06', startTime: '20:00', title: 'Лики любви', performers: 'Ансамбль\nОрган', program: 'Бах\nГлинка', issue: null });
  });
  it('находит колонки по заголовкам, а не по номеру', () => {
    expect(parseConcerts([{ name: '2026', rows: [
      ['время', 'ОПИСАНИЕ', 'артисты', 'название', 'дата'],
      ['20:30', 'Программа', 'Ансамбль', 'Концерт', new Date('2026-10-07T00:00:00Z')],
    ] }], '2026-10')[0]).toMatchObject({ date: '2026-10-07', startTime: '20:30', program: 'Программа' });
  });
  it('читает Excel-время с округлением и дату ISO', () => {
    expect(parseConcerts(table([['2026-10-07', 'Концерт', new Date('1899-12-30T20:29:59.999Z')]]), '2026-10')[0])
      .toMatchObject({ date: '2026-10-07', startTime: '20:30', issue: null });
  });
  it('читает дату без года из годового листа и время-долю суток', () => {
    expect(parseConcerts(table([['6.10', 'Концерт', 20 / 24]]), '2026-10')[0])
      .toMatchObject({ date: '2026-10-06', startTime: '20:00', issue: null });
  });
  it('оставляет пустые поля пустыми и не использует другую колонку программы', () => {
    expect(parseConcerts(table([['6.10.2026', '', '20:00', '', '', 'Не брать']]), '2026-10')[0])
      .toMatchObject({ title: null, performers: null, program: null });
  });
  it('не переносит данные другого месяца и пропускает пустые строки', () => {
    expect(parseConcerts(table([[], ['6.09.2026', 'Сентябрь', '20:00'], ['6.10.2026', 'Октябрь', '20:00']]), '2026-10'))
      .toHaveLength(1);
  });
  it.each(['31.10.2026!', '32.10.2026', '2026-02-30'])('не исправляет ошибочную дату %s молча', date => {
    expect(parseConcerts(table([[date, 'Концерт', '20:00']]), '2026-10')[0].issue).not.toBeNull();
  });
  it.each(['25:00', '20:00\n22:00', 'примерно вечером'])('не выбирает время %s наугад', time => {
    expect(parseConcerts(table([['6.10.2026', 'Концерт', time]]), '2026-10')[0].issue).not.toBeNull();
  });
  it('блокирует обе строки при дублировании между листами', () => {
    const sheets = [...table([['6.10.2026', 'Первое', '20:00']]),
      { ...table([['6.10.2026', 'Второе', '20:00']])[0], name: 'Копия 2026' }];
    const rows = parseConcerts(sheets, '2026-10');
    expect(rows).toHaveLength(2);
    expect(rows.every(r => r.issue?.includes('Повтор'))).toBe(true);
    expect(rows[0].key).not.toBe(rows[1].key);
  });
});

import { afterAll, beforeEach } from 'vitest';
import { asManager, asWorker, resetTestDb, testSql } from './setup';
import { previewConcerts, applyConcerts } from '@/lib/concerts/operations';

let eventId: string;
let workerId: string;
let positionId: string;
const incoming = () => parseConcerts(table([['6.10.2026', 'Лики любви', '20:00', 'Ансамбль', 'Бах\nГлинка']]), '2026-10');
describe('обновление существующих концертов под ролью приложения', () => {
beforeEach(async () => {
  await resetTestDb();
  const [e] = await testSql<{ id: string }[]>`insert into event(event_date,start_time,concert,base_rate,comment)
    values ('2026-10-06','20:00','Органный вторник',1500,'Ручная заметка') returning id`;
  eventId = e.id;
  const [w] = await testSql<{ id: string }[]>`insert into worker(full_name,name_key) values ('Тестовый работник','тестовый работник') returning id`;
  workerId = w.id;
  const [p] = await testSql<{ id: string }[]>`select id from position where name='ЗАЛ'`;
  positionId = p.id;
  await testSql`insert into event_slot(event_id,position_id,quantity,rate,type_rate) values (${eventId},${positionId},2,2100,1700)`;
  await testSql`insert into assignment(worker_id,event_id,position_id,rate) values (${workerId},${eventId},${positionId},2200)`;
});
afterAll(() => testSql.end());

  it('меняет только название, программу и исполнителей, сохраняя смены и оплату', async () => {
    const rows = incoming();
    const preview = await asManager(tx => previewConcerts(tx, rows));
    expect(preview.rows[0]).toMatchObject({ eventId, issue: null, changed: true, before: { title: 'Органный вторник' } });
    expect(await asManager(tx => applyConcerts(tx, rows, [rows[0].key], preview.snapshot))).toBe(1);
    expect((await testSql`select concert, program, performers,base_rate,comment from event where id=${eventId}`)[0])
      .toMatchObject({ concert: 'Лики любви', program: 'Бах\nГлинка', performers: 'Ансамбль', base_rate: 1500, comment: 'Ручная заметка' });
    expect((await testSql`select quantity,rate,type_rate from event_slot where event_id=${eventId}`)[0])
      .toMatchObject({ quantity: 2, rate: 2100, type_rate: 1700 });
    expect((await testSql`select position_id,rate from assignment where event_id=${eventId}`)[0])
      .toMatchObject({ position_id: positionId, rate: 2200 });
  });
  it('не создаёт новый концерт и не принимает неподходящие строки из браузера', async () => {
    const rows = parseConcerts(table([['7.10.2026','Нет в календаре','20:00','Артист','Программа']]), '2026-10');
    const preview = await asManager(tx => previewConcerts(tx,rows));
    expect(preview.rows[0].issue).toContain('Нет мероприятия');
    await expect(asManager(tx => applyConcerts(tx,rows,[rows[0].key],preview.snapshot))).rejects.toThrow();
    expect((await testSql`select count(*)::int as n from event`)[0].n).toBe(1);
  });
  it('пустые ячейки не стирают ранее заполненные данные', async () => {
    await testSql`update event set program='Прежняя программа',performers='Прежний артист' where id=${eventId}`;
    const rows = parseConcerts(table([['6.10.2026','','20:00','','']]), '2026-10');
    const preview = await asManager(tx => previewConcerts(tx,rows));
    expect(await asManager(tx => applyConcerts(tx,rows,[rows[0].key],preview.snapshot))).toBe(0);
    expect((await testSql`select concert,program,performers from event where id=${eventId}`)[0])
      .toMatchObject({ concert:'Органный вторник',program:'Прежняя программа',performers:'Прежний артист' });
  });
  it('повторная загрузка не создаёт дублей и не считает неизменённые строки обновлёнными', async () => {
    const rows = incoming();
    let preview = await asManager(tx => previewConcerts(tx,rows));
    await asManager(tx => applyConcerts(tx,rows,[rows[0].key],preview.snapshot));
    preview = await asManager(tx => previewConcerts(tx,rows));
    expect(preview.rows[0].changed).toBe(false);
    expect(await asManager(tx => applyConcerts(tx,rows,[rows[0].key],preview.snapshot))).toBe(0);
    expect((await testSql`select count(*)::int as n from event`)[0].n).toBe(1);
  });
  it('отклоняет сверку после ручной правки и ничего не записывает', async () => {
    const rows = incoming();
    const preview = await asManager(tx => previewConcerts(tx,rows));
    await testSql`update event set concert='Ручное название' where id=${eventId}`;
    await expect(asManager(tx => applyConcerts(tx,rows,[rows[0].key],preview.snapshot))).rejects.toThrow('сверку');
    expect((await testSql`select concert,program from event where id=${eventId}`)[0])
      .toMatchObject({ concert:'Ручное название',program:null });
  });
  it('карточка мероприятия читает сохранённую программу и исполнителей', async () => {
    await testSql`update event set program='Полная программа',performers='Все исполнители' where id=${eventId}`;
    const card=await asManager(tx=>getEventCard(tx,eventId));
    expect(card?.event).toMatchObject({program:'Полная программа',performers:'Все исполнители'});
  });
  it('не применяет выбранные данные, если изменилось содержимое исходной строки', async () => {
    const rows = incoming();
    const preview = await asManager(tx => previewConcerts(tx,rows));
    await expect(asManager(tx => applyConcerts(tx,[{...rows[0],title:'Другое название'}],[rows[0].key],preview.snapshot)))
      .rejects.toThrow('сверку');
  });
  it('ошибка поздней строки откатывает раннее обновление', async () => {
    const rows = [...incoming(), ...parseConcerts(table([['7.10.2026','Нет в календаре','20:00']]),'2026-10').map(r=>({...r,key:'missing'}))];
    const preview = await asManager(tx => previewConcerts(tx,rows));
    await expect(asManager(tx => applyConcerts(tx,rows,rows.map(r=>r.key),preview.snapshot))).rejects.toThrow();
    expect((await testSql`select concert from event where id=${eventId}`)[0].concert).toBe('Органный вторник');
  });
  it('работник не может обновить мероприятие', async () => {
    const rows = incoming();
    const preview = await asManager(tx => previewConcerts(tx,rows));
    await expect(asWorker(workerId,tx => applyConcerts(tx,rows,[rows[0].key],preview.snapshot))).rejects.toThrow();
    expect((await testSql`select concert from event where id=${eventId}`)[0].concert).toBe('Органный вторник');
  });
});
