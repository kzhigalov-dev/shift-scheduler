import { beforeEach, expect, it, vi } from 'vitest';
import { UserError } from '@/lib/errors';
const mocks = vi.hoisted(() => ({
  auth: vi.fn(), db: vi.fn(), revalidate: vi.fn(), preview: vi.fn(), apply: vi.fn(), today: vi.fn(),
}));
vi.mock('@/lib/auth/session', () => ({ requireManager: mocks.auth }));
vi.mock('@/db/client', () => ({ withManager: mocks.db }));
vi.mock('@/lib/distribute/operations', () => ({ previewDistribution: mocks.preview, applyDistribution: mocks.apply }));
vi.mock('@/lib/month', async (importOriginal) => ({ ...await importOriginal<typeof import('@/lib/month')>(), currentDate: mocks.today }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
import { previewDistributeEventAction, applyDistributionAction } from '@/app/(manager)/event/[id]/actions';
import { previewDistributeMonthAction } from '@/app/(manager)/month/[month]/plan/actions';
import { secureRandomInt } from '@/lib/distribute/random';
import type { DistributionRow } from '@/lib/distribute/rows';

const EVENT = '00000000-0000-4000-8000-000000000001';
const WORKER = '00000000-0000-4000-8000-000000000002';
const POSITION = '00000000-0000-4000-8000-000000000003';
const TX = { tx: true };
const BAD = 'Некорректный запрос';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue(undefined);
  mocks.db.mockImplementation((fn: (tx: unknown) => unknown) => fn(TX));
  mocks.today.mockReturnValue('2099-09-15');
});

it('проверяет вход до разбора аргументов и обращения к базе', async () => {
  mocks.auth.mockRejectedValue(new Error('redirect'));
  await expect(previewDistributeEventAction('нет')).rejects.toThrow('redirect');
  await expect(previewDistributeMonthAction('нет')).rejects.toThrow('redirect');
  await expect(applyDistributionAction([])).rejects.toThrow('redirect');
  expect(mocks.db).not.toHaveBeenCalled();
});

it('отклоняет повреждённые id, месяц и строки без обращения к базе', async () => {
  expect(await previewDistributeEventAction('нет')).toEqual({ error: BAD, preview: null });
  expect(await previewDistributeMonthAction('2099-13')).toEqual({ error: BAD, preview: null });
  expect(await previewDistributeMonthAction(7 as unknown as string)).toEqual({ error: BAD, preview: null });
  const bad = [
    'строка', null, [{ eventId: 'x', workerId: WORKER, positionId: POSITION }],
    Array.from({ length: 501 }, () => ({ eventId: EVENT, workerId: WORKER, positionId: null })),
  ];
  for (const rows of bad) {
    expect(await applyDistributionAction(rows as unknown as DistributionRow[])).toEqual({ error: BAD, applied: 0, skipped: 0 });
  }
  expect(mocks.db).not.toHaveBeenCalled();
});

it('предпросмотр мероприятия: случайность — crypto на сервере, ничего не обновляет', async () => {
  const preview = [{ eventId: EVENT, rows: [] }];
  mocks.preview.mockResolvedValue(preview);
  expect(await previewDistributeEventAction(EVENT)).toEqual({ error: null, preview });
  expect(mocks.preview).toHaveBeenCalledWith(TX, { eventId: EVENT }, secureRandomInt);
  expect(mocks.revalidate).not.toHaveBeenCalled();
  mocks.preview.mockRejectedValue(new UserError('Мероприятие не найдено — обновите страницу'));
  expect(await previewDistributeEventAction(EVENT)).toEqual({ error: 'Мероприятие не найдено — обновите страницу', preview: null });
  mocks.preview.mockRejectedValue(new Error('сырая ошибка базы'));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  expect((await previewDistributeEventAction(EVENT)).error).not.toMatch(/сырая/);
});

it('предпросмотр месяца считает «сегодня» по Москве', async () => {
  mocks.preview.mockResolvedValue([]);
  expect(await previewDistributeMonthAction('2099-09')).toEqual({ error: null, preview: [] });
  expect(mocks.preview).toHaveBeenCalledWith(TX, { month: '2099-09', today: '2099-09-15' }, secureRandomInt);
  expect(mocks.revalidate).not.toHaveBeenCalled();
});

it('применение возвращает итог и обновляет мероприятия и месяцы', async () => {
  const rows = [{ eventId: EVENT, workerId: WORKER, positionId: POSITION }];
  mocks.apply.mockResolvedValue({ applied: 1, skipped: 2, eventIds: [EVENT], months: ['2099-09', '2099-10'] });
  expect(await applyDistributionAction(rows)).toEqual({ error: null, applied: 1, skipped: 2 });
  expect(mocks.apply).toHaveBeenCalledWith(TX, rows);
  expect(mocks.revalidate).toHaveBeenCalledWith('/event/[id]', 'page');
  for (const path of ['/month', '/month/2099-09/plan', '/month/2099-10/plan']) expect(mocks.revalidate).toHaveBeenCalledWith(path);
  mocks.revalidate.mockClear();
  mocks.apply.mockRejectedValue(new UserError('Нет прав'));
  expect(await applyDistributionAction(rows)).toEqual({ error: 'Нет прав', applied: 0, skipped: 0 });
  expect(mocks.revalidate).not.toHaveBeenCalled();
});

it('строки из браузера передаются только разобранными: лишние поля отбрасываются', async () => {
  mocks.apply.mockResolvedValue({ applied: 0, skipped: 0, eventIds: [], months: [] });
  const raw = [{ eventId: EVENT, workerId: WORKER, positionId: null, extra: 'x' }];
  await applyDistributionAction(raw as unknown as DistributionRow[]);
  expect(mocks.apply).toHaveBeenCalledWith(TX, [{ eventId: EVENT, workerId: WORKER, positionId: null }]);
});
