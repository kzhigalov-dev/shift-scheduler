import { describe, it, expect, beforeEach } from 'vitest';
import { resetTestDb, testSql, asManager, asAppAnon } from './setup';
import {
  createManagerSession, isManagerSessionValid, deleteManagerSession,
} from '@/lib/auth/managerSession';

beforeEach(async () => {
  await resetTestDb();
});

describe('сессия менеджера', () => {
  it('созданная сессия действительна при проверке без личности', async () => {
    const token = await asManager((tx) => createManagerSession(tx));
    expect(await asAppAnon((tx) => isManagerSessionValid(tx, token))).toBe(true);
  });

  it('в базе лежит хеш, а не токен', async () => {
    const token = await asManager((tx) => createManagerSession(tx));
    const rows = await testSql`select token_hash from manager_session`;
    expect(rows[0].token_hash).not.toBe(token);
  });

  it('чужой токен недействителен', async () => {
    await asManager((tx) => createManagerSession(tx));
    expect(await asAppAnon((tx) => isManagerSessionValid(tx, 'чужой'))).toBe(false);
  });

  it('удалённая сессия недействительна', async () => {
    const token = await asManager((tx) => createManagerSession(tx));
    await asManager((tx) => deleteManagerSession(tx, token));
    expect(await asAppAnon((tx) => isManagerSessionValid(tx, token))).toBe(false);
  });

  it('создание новой сессии вычищает просроченные', async () => {
    await testSql`insert into manager_session (token_hash, expires_at)
                  values ('old', now() - interval '1 day')`;
    await asManager((tx) => createManagerSession(tx));
    const rows = await testSql`select token_hash from manager_session where token_hash = 'old'`;
    expect(rows).toHaveLength(0);
  });
});
