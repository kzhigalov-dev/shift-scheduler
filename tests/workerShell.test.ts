import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { resetTestDb, testSql, asWorker } from './setup';

// Подменяем только границы запроса Next; привязка читается из настоящей БД под RLS.
const state = vi.hoisted(() => ({ workerId: '', configured: false }));
vi.mock('@/lib/auth/session', () => ({
  requireWorker: async () => ({ id: state.workerId, fullName: 'Проверка' }),
}));
vi.mock('@/db/client', () => ({ withWorker: asWorker }));
vi.mock('@/lib/telegram/config', () => ({ isTelegramConfigured: () => state.configured }));
vi.mock('next/navigation', () => ({ usePathname: () => '/shifts' }));
const { WorkerShell } = await import('@/components/WorkerShell');

beforeEach(async () => {
  await resetTestDb();
  const [worker] = await testSql<{ id: string }[]>`insert into worker(full_name,name_key) values ('Проверка','проверка') returning id`;
  state.workerId = worker.id;
  state.configured = false;
});
async function header() {
  const html = renderToStaticMarkup(await WorkerShell({ fullName: 'Проверка', title: 'Смены', children: null }));
  return /<header\b[^>]*>([\s\S]*?)<\/header>/.exec(html)?.[1] ?? '';
}
it('на любом экране работника есть доступная ссылка на уведомления в шапке', async () => {
  expect(await header()).toMatch(/<a [^>]*aria-label="Уведомления"[^>]*href="\/notifications"|<a [^>]*href="\/notifications"[^>]*aria-label="Уведомления"/);
});
it('напоминает подключить настроенного бота; чужая привязка не скрывает напоминание', async () => {
  state.configured = true;
  const [other] = await testSql<{ id: string }[]>`insert into worker(full_name,name_key) values ('Другой','другой') returning id`;
  await testSql`insert into telegram_link(worker_id,chat_id) values (${other.id},-1001)`;
  expect(await header()).toContain('Подключите Telegram');
});
it('после подключения своей привязки напоминание исчезает', async () => {
  state.configured = true;
  await testSql`insert into telegram_link(worker_id,chat_id) values (${state.workerId},-1002)`;
  const html = await header();
  expect(html).toContain('href="/notifications"');
  expect(html).not.toContain('Подключите Telegram');
});
it('без настроенного бота не показывает напоминание о подключении', async () => {
  const html = await header();
  expect(html).toContain('href="/notifications"');
  expect(html).not.toContain('Подключите Telegram');
});
it('напоминание входит в доступное имя колокольчика (L10): aria-label не прячет его', async () => {
  state.configured = true;
  const html = await header();
  expect(html).toMatch(/<a [^>]*aria-label="Уведомления\. Подключите Telegram[^"]*"/);
  expect(html).not.toContain('sr-only');
});
