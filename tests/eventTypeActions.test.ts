import { beforeEach, expect, it, vi } from 'vitest';
import { UserError } from '@/lib/errors';
const mocks = vi.hoisted(()=>({auth:vi.fn(),save:vi.fn(),archive:vi.fn(),db:vi.fn(),revalidate:vi.fn()}));
vi.mock('@/lib/auth/session',()=>({requireManager:mocks.auth}));
vi.mock('@/db/client',()=>({withManager:mocks.db}));
vi.mock('@/lib/eventTypes/operations',()=>({saveEventType:mocks.save,setEventTypeArchived:mocks.archive}));
vi.mock('next/cache',()=>({revalidatePath:mocks.revalidate}));
import { saveEventTypeAction, archiveEventTypeAction } from '@/app/(manager)/event-types/actions';
beforeEach(()=>{vi.clearAllMocks();mocks.auth.mockResolvedValue(undefined)});
it('проверяет вход до разбора и обращения к базе', async ()=>{
  mocks.auth.mockRejectedValue(new Error('redirect'));
  await expect(saveEventTypeAction(new FormData())).rejects.toThrow('redirect');
  await expect(archiveEventTypeAction('нет',true)).rejects.toThrow('redirect');
  expect(mocks.db).not.toHaveBeenCalled();
});
it('возвращает ошибку формы без записи', async ()=>{
  const result = await saveEventTypeAction(new FormData());
  expect(result.error).toMatch(/название/i);expect(result.id).toBeNull();expect(mocks.db).not.toHaveBeenCalled();
});
it('показывает только UserError и обновляет экраны после успеха', async ()=>{
  mocks.db.mockRejectedValueOnce(new UserError('Вид в архиве'));
  expect((await archiveEventTypeAction('00000000-0000-0000-0000-000000000001',true)).error).toBe('Вид в архиве');
  mocks.db.mockResolvedValueOnce(undefined);
  expect((await archiveEventTypeAction('00000000-0000-0000-0000-000000000001',false)).error).toBeNull();
  expect(mocks.revalidate).toHaveBeenCalledWith('/event-types');
});
