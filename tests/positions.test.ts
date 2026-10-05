import { describe, it, expect, beforeEach } from 'vitest';
import { resetTestDb, testSql, asManager, asWorker } from './setup';
import { listPositions, updatePosition } from '@/app/(manager)/positions/operations';
import { defaultTypeSlots } from '@/lib/eventTypes/operations';
import { createEvent } from '@/lib/events';

const input = {
  date: '2026-08-06', startTime: '20:00', arriveTime: null, concert: null,
  tag: 'regular' as const, baseRate: 1300, comment: null,
};

beforeEach(async () => {
  await resetTestDb();
});

describe('должности', () => {
  it('перечисляет по порядку с шаблоном', async () => {
    const rows = await asManager((tx) => listPositions(tx));
    expect(rows[3]).toMatchObject({ name: 'БИЛЕТЫ', defaultQuantity: 3, defaultRate: null });
  });

  it('количество задаёт начальный шаблон нового вида, ставки действуют на мероприятия', async () => {
    const admin = (await asManager((tx) => listPositions(tx)))[0];
    await asManager((tx) => updatePosition(tx, { id: admin.id, defaultQuantity: 2, defaultRate: 2500 }));
    const id = await asManager((tx) => createEvent(tx, input));
    const [slot] = await testSql`select quantity from event_slot
      where event_id = ${id} and position_id = ${admin.id}`;
    expect(slot.quantity).toBe(1);
    const defaults = await asManager(tx => defaultTypeSlots(tx));
    expect(defaults.find(p => p.positionId === admin.id)?.quantity).toBe(2);
    const [pos] = await testSql`select default_rate from position where id = ${admin.id}`;
    expect(pos.default_rate).toBe(2500);
  });

  it('существующие события не трогает', async () => {
    const id = await asManager((tx) => createEvent(tx, input));
    const admin = (await asManager((tx) => listPositions(tx)))[0];
    await asManager((tx) => updatePosition(tx, { id: admin.id, defaultQuantity: 5, defaultRate: null }));
    const [slot] = await testSql`select quantity from event_slot
      where event_id = ${id} and position_id = ${admin.id}`;
    expect(slot.quantity).toBe(1);
  });

  it('отвергает отрицательное количество', async () => {
    const admin = (await asManager((tx) => listPositions(tx)))[0];
    await expect(asManager((tx) =>
      updatePosition(tx, { id: admin.id, defaultQuantity: -1, defaultRate: null }))).rejects.toThrow();
  });

  it('отвергает слишком большое количество', async () => {
    const admin = (await asManager((tx) => listPositions(tx)))[0];
    await expect(asManager((tx) =>
      updatePosition(tx, { id: admin.id, defaultQuantity: 21, defaultRate: null }))).rejects.toThrow();
  });

  it('работник менять должности не может', async () => {
    const [w] = await testSql`insert into worker (full_name, name_key)
      values ('И', 'и') returning id`;
    const admin = (await asManager((tx) => listPositions(tx)))[0];
    await expect(asWorker(w.id, (tx) =>
      updatePosition(tx, { id: admin.id, defaultQuantity: 9, defaultRate: 9 }))).rejects.toThrow();
    const [pos] = await testSql`select default_quantity from position where id = ${admin.id}`;
    expect(pos.default_quantity).toBe(1);
  });

  it('несуществующий id — понятная ошибка', async () => {
    await expect(asManager((tx) => updatePosition(tx, {
      id: '00000000-0000-0000-0000-000000000000', defaultQuantity: 1, defaultRate: null,
    }))).rejects.toThrow('Должность не найдена — обновите страницу');
  });
});
