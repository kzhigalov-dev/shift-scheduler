import { describe, it, expect, afterAll } from 'vitest';

describe('клиент базы', () => {
  it('импорт модуля без DATABASE_URL не падает — пул ленивый', async () => {
    const saved = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    await expect(import('@/db/client')).resolves.toBeDefined();
    process.env.DATABASE_URL = saved;
  });

  it('ходит ролью app_user в московском времени', async () => {
    process.env.DATABASE_URL = process.env.DATABASE_URL_TEST_APP;
    const { withAnon } = await import('@/db/client');
    const [row] = await withAnon((tx) =>
      tx<{ who: string; tz: string }[]>`
        select current_user as who, current_setting('timezone') as tz`);
    expect(row).toEqual({ who: 'app_user', tz: 'Europe/Moscow' });
  });

  it('withWorker и withManager выставляют личность только на транзакцию', async () => {
    const { withWorker, withManager, withAnon } = await import('@/db/client');
    const id = '00000000-0000-0000-0000-000000000001';

    const [w] = await withWorker(id, (tx) =>
      tx<{ v: string }[]>`select current_setting('app.worker_id', true) as v`);
    expect(w.v).toBe(id);

    const [m] = await withManager((tx) =>
      tx<{ v: string }[]>`select current_setting('app.is_manager', true) as v`);
    expect(m.v).toBe('true');

    const [a] = await withAnon((tx) =>
      tx<{ w: string | null; m: string | null }[]>`
        select nullif(current_setting('app.worker_id', true), '') as w,
               nullif(current_setting('app.is_manager', true), '') as m`);
    expect(a).toEqual({ w: null, m: null });
  });
});

afterAll(async () => {
  const { closePool } = await import('@/db/client');
  await closePool();
});
