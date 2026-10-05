import { describe, it, expect, beforeEach } from 'vitest';
import { resetTestDb, testSql, asManager, asWorker, asAppAnon } from './setup';
import {
  listWorkers, createWorker, updateWorker, issueToken, archiveWorker, restoreWorker, parsePhone,
} from '@/app/(manager)/workers/operations';
import { feedWorkerId, isManagerFeed, issueManagerFeed, issueWorkerFeed } from '@/lib/calendar/feedKeys';
import { hashToken } from '@/lib/auth/token';
import { UserError } from '@/lib/errors';

beforeEach(async () => {
  await resetTestDb();
});

const create = (fullName: string) =>
  asManager((tx) => createWorker(tx, { fullName, phone: null }));

describe('parsePhone', () => {
  it('пустая строка и null становятся null', () => {
    expect(parsePhone('')).toBeNull();
    expect(parsePhone('   ')).toBeNull();
    expect(parsePhone(null)).toBeNull();
  });

  it('обрезает пробелы по краям', () => {
    expect(parsePhone(' +7 999 123-45-67 ')).toBe('+7 999 123-45-67');
  });

  it('отвергает слишком длинную строку', () => {
    const long = '+7'.padEnd(33, '9');
    expect(() => parsePhone(long)).toThrow(UserError);
    expect(() => parsePhone(long)).toThrow(/32/);
  });

  it('пропускает строку ровно на границе длины', () => {
    const ok = '9'.repeat(32);
    expect(parsePhone(ok)).toBe(ok);
  });
});

describe('работники', () => {
  it('создаёт с чистым именем и ключом', async () => {
    const id = await create('Кирилл Демонстрационный**');
    const [row] = await testSql`select full_name, name_key from worker where id = ${id}`;
    expect(row).toEqual({ full_name: 'Кирилл Демонстрационный', name_key: 'демонстрационный кирилл' });
  });

  it('отвергает пустое имя', async () => {
    await expect(create('')).rejects.toThrow(UserError);
    await expect(create('   ')).rejects.toThrow(/имя/i);
    await expect(create('**')).rejects.toThrow(/имя/i);
  });

  it('на дубль отвечает понятной ошибкой', async () => {
    await create('Полина Демонстрационная');
    await expect(create('Демонстрационная Полина')).rejects.toThrow(/уже есть/);
  });

  it('правит имя и телефон', async () => {
    const id = await create('Илья');
    await asManager((tx) => updateWorker(tx, { id, fullName: 'Илья Примерный', phone: '+7 999' }));
    const [row] = await testSql`select full_name, name_key, phone from worker where id = ${id}`;
    expect(row).toEqual({ full_name: 'Илья Примерный', name_key: 'илья примерный', phone: '+7 999' });
  });

  it('отвергает пустое имя при правке', async () => {
    const id = await create('Илья');
    await expect(asManager((tx) => updateWorker(tx, { id, fullName: '  **  ', phone: null })))
      .rejects.toThrow(/имя/i);
  });

  it('в базе лежит хеш токена, перевыпуск убивает старый', async () => {
    const id = await create('Илья');
    const first = await asManager((tx) => issueToken(tx, id));
    const second = await asManager((tx) => issueToken(tx, id));
    const [row] = await testSql`select token_hash from worker where id = ${id}`;
    expect(row.token_hash).toBe(hashToken(second));
    expect(row.token_hash).not.toBe(hashToken(first));
  });

  it('перевыпуск ссылки отключает Telegram этого работника и не трогает чужие чаты', async () => {
    const id = await create('Илья');
    const other = await create('Артем');
    await testSql`insert into telegram_link (worker_id, chat_id) values (${id}, 101), (${other}, 102), (null, 900)`;
    await asManager((tx) => issueToken(tx, id));
    const rows = await testSql`select worker_id, chat_id::int as chat_id from telegram_link order by chat_id`;
    expect(rows).toEqual([{ worker_id: other, chat_id: 102 }, { worker_id: null, chat_id: 900 }]);
  });

  it('перевыпуск ссылки гасит ключ календаря работника; чужой ключ и ключ менеджера остаются (M1)', async () => {
    const id = await create('Илья');
    const other = await create('Артем');
    const mine = await asWorker(id, (tx) => issueWorkerFeed(tx, id, false));
    const theirs = await asWorker(other, (tx) => issueWorkerFeed(tx, other, false));
    const manager = await asManager((tx) => issueManagerFeed(tx, false));
    await asManager((tx) => issueToken(tx, id));
    expect(await asAppAnon((tx) => feedWorkerId(tx, mine))).toBeNull();
    expect(await asAppAnon((tx) => feedWorkerId(tx, theirs))).toBe(other);
    expect(await asAppAnon((tx) => isManagerFeed(tx, manager))).toBe(true);
    expect(await testSql`select 1 from calendar_feed where worker_id = ${id}`).toHaveLength(0);
  });

  it('архив гасит ключ календаря: возврат из архива его не оживляет (M1)', async () => {
    const id = await create('Илья');
    const key = await asWorker(id, (tx) => issueWorkerFeed(tx, id, false));
    await asManager((tx) => archiveWorker(tx, id));
    await asManager((tx) => restoreWorker(tx, id));
    expect(await asAppAnon((tx) => feedWorkerId(tx, key))).toBeNull();
    expect(await testSql`select 1 from calendar_feed where worker_id = ${id}`).toHaveLength(0);
  });

  it('перевыпуск ссылки работнику без Telegram проходит, отказ (архив) чат не удаляет', async () => {
    const id = await create('Илья');
    await asManager((tx) => issueToken(tx, id));
    await asManager((tx) => archiveWorker(tx, id));
    await testSql`insert into telegram_link (worker_id, chat_id) values (${id}, 101)`;
    await expect(asManager((tx) => issueToken(tx, id))).rejects.toThrow(/архиве/);
    expect(await testSql`select 1 from telegram_link where worker_id = ${id}`).toHaveLength(1);
  });

  it('архив убирает ссылку и не даёт выдать новую, возврат ссылку не выдаёт', async () => {
    const id = await create('Илья');
    await asManager((tx) => issueToken(tx, id));
    await asManager((tx) => archiveWorker(tx, id));
    let [row] = await testSql`select status, token_hash from worker where id = ${id}`;
    expect(row).toEqual({ status: 'archived', token_hash: null });
    await expect(asManager((tx) => issueToken(tx, id))).rejects.toThrow(/архиве/);
    await asManager((tx) => restoreWorker(tx, id));
    [row] = await testSql`select status, token_hash from worker where id = ${id}`;
    expect(row).toEqual({ status: 'active', token_hash: null });
  });

  it('перечисляет с признаком ссылки', async () => {
    const id = await create('Илья');
    await create('Артем');
    await asManager((tx) => issueToken(tx, id));
    const rows = await asManager((tx) => listWorkers(tx));
    expect(rows.map((r) => [r.fullName, r.hasLink])).toEqual([['Артем', false], ['Илья', true]]);
  });

  it('несуществующий id: правка не проходит молча', async () => {
    await expect(asManager((tx) =>
      updateWorker(tx, { id: '00000000-0000-0000-0000-000000000000', fullName: 'Кто-то', phone: null })))
      .rejects.toThrow(/не найден/);
  });

  it('несуществующий id: архив не проходит молча', async () => {
    await expect(asManager((tx) =>
      archiveWorker(tx, '00000000-0000-0000-0000-000000000000')))
      .rejects.toThrow(/не найден/);
  });

  it('несуществующий id: возврат из архива не проходит молча', async () => {
    await expect(asManager((tx) =>
      restoreWorker(tx, '00000000-0000-0000-0000-000000000000')))
      .rejects.toThrow(/не найден/);
  });
});
