import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetTestDb } from './setup';
import { closePool, withManager } from '@/db/client';
import { findWorkerByToken } from '@/lib/auth/workerLookup';
import { createWorker, issueToken, archiveWorker, restoreWorker } from '@/app/(manager)/workers/operations';

beforeAll(async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL_TEST_APP;
  await resetTestDb();
});

afterAll(async () => {
  await closePool();
});

/**
 * То, что бриф просил проверить руками (ссылка → /shifts, протухшая → /login),
 * но чем нельзя было пройти через браузерную песочницу: она не даёт ни прочитать
 * выданный токен из DOM, ни сминтить свой в обход UI. Здесь тот же путь — от
 * issueToken до входа по токену — воспроизведён внутри процесса, ролью app_user
 * (DATABASE_URL_TEST_APP), без обхода RLS через SET LOCAL ROLE.
 */
describe('сквозной путь личной ссылки', () => {
  it('выдача, перевыпуск, архив и возврат — ссылка ведёт туда, куда должна', async () => {
    const workerId = await withManager((tx) =>
      createWorker(tx, { fullName: 'Илья Примерный', phone: null }));

    const first = await withManager((tx) => issueToken(tx, workerId));
    await expect(findWorkerByToken(first)).resolves.toEqual({ id: workerId, fullName: 'Илья Примерный' });

    const second = await withManager((tx) => issueToken(tx, workerId));
    await expect(findWorkerByToken(first)).resolves.toBeNull();
    await expect(findWorkerByToken(second)).resolves.toEqual({ id: workerId, fullName: 'Илья Примерный' });

    await withManager((tx) => archiveWorker(tx, workerId));
    await expect(findWorkerByToken(second)).resolves.toBeNull();

    await withManager((tx) => restoreWorker(tx, workerId));
    await expect(findWorkerByToken(second)).resolves.toBeNull();
  });
});
