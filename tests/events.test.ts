import { describe, it, expect, beforeEach } from 'vitest';
import { resetTestDb, testSql, asManager } from './setup';
import {
  parseRate, parseEventForm, createEvent, updateEvent, deleteEvent, setEventField, normalizeTime, MAX_RATE,
} from '@/lib/events';
import { UserError } from '@/lib/errors';

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

const valid = {
  date: '2026-08-06', startTime: '20:00', arriveTime: '18:00',
  concert: 'Лунный свет', tag: 'night', baseRate: '2000', comment: '',
};

describe('parseRate', () => {
  it('пусто — null, число — целое', () => {
    expect(parseRate('')).toBeNull();
    expect(parseRate(null)).toBeNull();
    expect(parseRate(' 1300 ')).toBe(1300);
    expect(parseRate('0')).toBe(0);
  });

  it('отвергает дробь, минус и текст', () => {
    expect(() => parseRate('1300.5')).toThrow(/ставк/i);
    expect(() => parseRate('-1')).toThrow(/ставк/i);
    expect(() => parseRate('много')).toThrow(/ставк/i);
  });

  it('ограничивает ставку сверху', () => {
    expect(MAX_RATE).toBe(1_000_000);
    expect(parseRate('1000000')).toBe(1_000_000);
    expect(() => parseRate('1000001')).toThrow(UserError);
    expect(() => parseRate('1000001')).toThrow('Ставка больше 1 000 000 ₽ — проверьте число');
    expect(() => parseRate('99999999999999999999')).toThrow('Ставка больше 1 000 000 ₽ — проверьте число');
  });
});

describe('parseEventForm', () => {
  it('собирает событие из формы', () => {
    expect(parseEventForm(form(valid))).toEqual({
      date: '2026-08-06', startTime: '20:00', arriveTime: '18:00',
      concert: 'Лунный свет', tag: 'night', baseRate: 2000, comment: null,
    });
  });

  it('отвергает кривые дату, время и тег', () => {
    expect(() => parseEventForm(form({ ...valid, date: '6.8' }))).toThrow(/дат/i);
    expect(() => parseEventForm(form({ ...valid, startTime: '25:00' }))).toThrow(/врем/i);
    expect(() => parseEventForm(form({ ...valid, tag: 'party' }))).toThrow(/тип/i);
  });
});

describe('операции с событиями', () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  const input = parseEventForm(form(valid));

  it('создаёт событие со слотами из шаблона', async () => {
    const id = await asManager((tx) => createEvent(tx, input));
    const [{ total }] = await testSql`
      select sum(quantity)::int as total from event_slot where event_id = ${id}`;
    expect(total).toBe(9);
  });

  it('на занятое время отвечает понятной ошибкой', async () => {
    await asManager((tx) => createEvent(tx, input));
    await expect(asManager((tx) => createEvent(tx, input))).rejects.toThrow(/уже есть событие/);
  });

  it('правка и удаление несуществующего события — понятная ошибка, а не тихий успех', async () => {
    const id = await asManager((tx) => createEvent(tx, input));
    await asManager((tx) => deleteEvent(tx, id));
    const gone = new UserError('Событие не найдено — обновите страницу');
    await expect(asManager((tx) => updateEvent(tx, id, input))).rejects.toThrow(gone);
    await expect(asManager((tx) => deleteEvent(tx, id))).rejects.toThrow(gone);
    await expect(asManager((tx) => updateEvent(tx, id, input))).rejects.toBeInstanceOf(UserError);
  });

  it('обновляет и удаляет', async () => {
    const id = await asManager((tx) => createEvent(tx, input));
    await asManager((tx) => updateEvent(tx, id, { ...input, concert: 'Органный вторник' }));
    const [row] = await testSql`select concert from event where id = ${id}`;
    expect(row.concert).toBe('Органный вторник');
    await asManager((tx) => deleteEvent(tx, id));
    const rows = await testSql`select id from event`;
    expect(rows).toHaveLength(0);
  });
});

describe('приход', () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  const arriveOf = async (id: string) => (await testSql`
    select to_char(arrive_time, 'HH24:MI') as arrive, arrive_manual as manual,
           to_char(start_time, 'HH24:MI') as start, base_rate
    from event where id = ${id}`)[0];

  it('пустой приход при создании — автоматический по типу', async () => {
    const regular = await asManager((tx) => createEvent(tx, parseEventForm(form({ ...valid, tag: 'regular', arriveTime: '' }))));
    expect(await arriveOf(regular)).toMatchObject({ arrive: '18:00', manual: false });
    const night = await asManager((tx) => createEvent(tx, parseEventForm(form({
      ...valid, date: '2026-08-07', startTime: '22:30', tag: 'night', arriveTime: '',
    }))));
    expect(await arriveOf(night)).toMatchObject({ arrive: '21:00', manual: false });
  });

  it('указанный при создании приход — ручной', async () => {
    const id = await asManager((tx) => createEvent(tx, parseEventForm(form(valid))));
    expect(await arriveOf(id)).toMatchObject({ arrive: '18:00', manual: true });
  });

  it('правка начала: автоматический пересчитывается, ручной остаётся', async () => {
    const auto = await asManager((tx) => createEvent(tx, parseEventForm(form({ ...valid, tag: 'regular', arriveTime: '' }))));
    await asManager((tx) => updateEvent(tx, auto, parseEventForm(form({
      ...valid, tag: 'regular', startTime: '21:00', arriveTime: '18:00',
    }))));
    expect(await arriveOf(auto)).toMatchObject({ arrive: '19:00', manual: false });

    const manual = await asManager((tx) => createEvent(tx, parseEventForm(form({ ...valid, date: '2026-08-08' }))));
    await asManager((tx) => updateEvent(tx, manual, parseEventForm(form({
      ...valid, date: '2026-08-08', startTime: '21:00', arriveTime: '18:00',
    }))));
    expect(await arriveOf(manual)).toMatchObject({ arrive: '18:00', manual: true });
  });

  it('setEventField: начало, приход, ставка', async () => {
    const id = await asManager((tx) => createEvent(tx, parseEventForm(form({ ...valid, tag: 'regular', arriveTime: '' }))));
    await asManager((tx) => setEventField(tx, id, 'startTime', '19:30'));
    expect(await arriveOf(id)).toMatchObject({ start: '19:30', arrive: '17:30', manual: false });
    await asManager((tx) => setEventField(tx, id, 'arriveTime', '9:15'));
    expect(await arriveOf(id)).toMatchObject({ arrive: '09:15', manual: true });
    await asManager((tx) => setEventField(tx, id, 'startTime', '20:00'));
    expect(await arriveOf(id)).toMatchObject({ start: '20:00', arrive: '09:15', manual: true });
    await asManager((tx) => setEventField(tx, id, 'arriveTime', ''));
    expect(await arriveOf(id)).toMatchObject({ arrive: '18:00', manual: false });
    await asManager((tx) => setEventField(tx, id, 'baseRate', '1500'));
    expect(await arriveOf(id)).toMatchObject({ base_rate: 1500 });
    await asManager((tx) => setEventField(tx, id, 'baseRate', ''));
    expect(await arriveOf(id)).toMatchObject({ base_rate: null });
  });

  it('setEventField отвергает кривое время и занятое начало', async () => {
    const a = await asManager((tx) => createEvent(tx, parseEventForm(form(valid))));
    await asManager((tx) => createEvent(tx, parseEventForm(form({ ...valid, startTime: '22:30' }))));
    await expect(asManager((tx) => setEventField(tx, a, 'startTime', '25:00'))).rejects.toThrow('Неверное время начала');
    await expect(asManager((tx) => setEventField(tx, a, 'startTime', ''))).rejects.toThrow('Неверное время начала');
    await expect(asManager((tx) => setEventField(tx, a, 'arriveTime', 'утро'))).rejects.toThrow('Неверное время прихода');
    await expect(asManager((tx) => setEventField(tx, a, 'startTime', '22:30'))).rejects.toThrow('На это время уже есть событие');
  });

  it('normalizeTime', () => {
    expect(normalizeTime('9:30')).toBe('09:30');
    expect(normalizeTime(' 21.05 ')).toBe('21:05');
    expect(normalizeTime('24:00')).toBeNull();
    expect(normalizeTime('')).toBeNull();
  });
});
