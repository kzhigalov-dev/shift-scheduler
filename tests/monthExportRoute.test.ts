import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import type { Tx } from '@/db/client';
import { resetTestDb, asManager } from './setup';
import { ev } from './scheduleFixtures';
import { createDraftMonth } from '@/lib/monthPlan/months';
import { readWorkbook } from '@/lib/import/workbook';
import { parseMonthSheet } from '@/lib/import/parseSheet';

// Настоящий requireManager: cookie — из jar, сессия «действительна» без базы, redirect — исключение с адресом.
const jar = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (name: string) => (jar.has(name) ? { value: jar.get(name) } : undefined) }),
}));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => { throw new Error(`redirect:${url}`); },
}));
vi.mock('@/lib/auth/managerSession', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/managerSession')>()),
  isManagerSessionValid: async () => true,
}));
// Данные — тестовая база под ролью приложения с правами менеджера; счётчик — «база не тронута».
const db = vi.hoisted(() => ({ managerCalls: 0 }));
vi.mock('@/db/client', async () => {
  const setup = await import('./setup');
  return {
    withAnon: <T>(fn: (tx: never) => Promise<T>) => fn({} as never),
    withManager: <T>(fn: (tx: Tx) => Promise<T>) => { db.managerCalls += 1; return setup.asManager(fn); },
  };
});

const { GET } = await import('@/app/(manager)/month/[month]/export/route');

const call = (month: string) =>
  GET(new Request(`http://localhost/month/${month}/export`), { params: Promise.resolve({ month }) });
const asManagerCookie = () => jar.set('manager_session', 'test-session');

beforeAll(async () => {
  await resetTestDb();
  await asManager((tx) => createDraftMonth(tx, '2099-10', [ev('2099-10-03', '20:00', 'Лунная соната')]));
});

beforeEach(() => {
  jar.clear();
  db.managerCalls = 0;
});

describe('GET /month/[month]/export', () => {
  it('без входа менеджера — на /login, база не тронута', async () => {
    await expect(call('2099-10')).rejects.toThrow('redirect:/login');
    expect(db.managerCalls).toBe(0);
  });

  it.each(['2099-13', '99-10', '2099-1', 'abc'])('неверный месяц «%s» — 404', async (month) => {
    asManagerCookie();
    const res = await call(month);
    expect(res.status).toBe(404);
    expect(db.managerCalls).toBe(0);
  });

  it('черновик месяца — файл .xlsx с листом месяца, без кеша', async () => {
    asManagerCookie();
    const res = await call('2099-10');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(res.headers.get('Content-Disposition')).toBe(
      `attachment; filename="annenkirche-2099-10.xlsx"; filename*=UTF-8''${encodeURIComponent('Анненкирхе — Октябрь 2099.xlsx')}`,
    );
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const [sheet] = await readWorkbook(Buffer.from(await res.arrayBuffer()));
    expect(sheet.name).toBe('Октябрь 2099');
    const parsed = parseMonthSheet(sheet.rows, sheet.name);
    expect(parsed.issues).toEqual([]);
    expect(parsed.events.map((e) => [e.date, e.startTime, e.concert])).toEqual([['2099-10-03', '20:00', 'Лунная соната']]);
  });

  it('месяц без мероприятий — лист только с подписями', async () => {
    asManagerCookie();
    const res = await call('2099-11');
    expect(res.status).toBe(200);
    const [sheet] = await readWorkbook(Buffer.from(await res.arrayBuffer()));
    expect(sheet.name).toBe('Ноябрь 2099');
    expect(sheet.rows.every((row) => row.length === 1)).toBe(true);
    expect(sheet.rows.map((row) => row[0])).toContain('Админ');
  });
});
