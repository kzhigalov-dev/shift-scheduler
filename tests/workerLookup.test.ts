import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetTestDb, testSql } from './setup';
import { generateToken, hashToken } from '@/lib/auth/token';
import { findWorkerByToken } from '@/lib/auth/workerLookup';
import { closePool } from '@/db/client';

const active = generateToken();
const archived = generateToken();
let activeId: string;

beforeAll(async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL_TEST_APP;
  await resetTestDb();
  const [a] = await testSql`insert into worker (full_name, name_key, token_hash)
    values ('Илья Примерный', 'илья примерный', ${hashToken(active)}) returning id`;
  await testSql`insert into worker (full_name, name_key, token_hash, status)
    values ('Архив', 'архив', ${hashToken(archived)}, 'archived')`;
  activeId = a.id;
});

afterAll(async () => {
  await closePool();
});

describe('findWorkerByToken', () => {
  it('находит работника по токену ролью приложения', async () => {
    expect(await findWorkerByToken(active)).toEqual({ id: activeId, fullName: 'Илья Примерный' });
  });

  it('не пускает архивного', async () => {
    expect(await findWorkerByToken(archived)).toBeNull();
  });

  it('не пускает по мусору', async () => {
    expect(await findWorkerByToken('мусор')).toBeNull();
  });
});
