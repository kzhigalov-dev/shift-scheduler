import { telegramApi, type TelegramApi } from '@/lib/telegram/api';
import type { BotDeps } from '@/lib/telegram/bot';
import { asAppAnon, asManager, asWorker } from './setup';

export type ApiCall = { method: string; body: Record<string, unknown> };

/** Bot API без сети: каждый запрос записывается; `fail` — какие из них ответить ошибкой 400. */
export function fakeApi(fail?: (call: ApiCall) => boolean): { api: TelegramApi; calls: ApiCall[] } {
  const calls: ApiCall[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    const call: ApiCall = { method: String(url).split('/').pop() ?? '', body: JSON.parse(String(init?.body)) };
    calls.push(call);
    if (fail?.(call)) return new Response(JSON.stringify({ ok: false, description: 'Bad Request' }), { status: 400 });
    return new Response(JSON.stringify({ ok: true, result: true }), { status: 200 });
  };
  return { api: telegramApi('TEST', fetchImpl), calls };
}

export const ORIGIN = 'https://a.app';
/** 12:00 по Москве, 8 июля 2099: мероприятия тестов — через 2–3 дня. */
export const NOW = new Date('2099-07-08T09:00:00Z');

/** Зависимости обработчика бота на тестовой базе: роли приложения вместо withAnon/withWorker/withManager. */
export function botDeps(api: TelegramApi, overrides: Partial<BotDeps> = {}): BotDeps {
  return {
    api, origin: ORIGIN, now: NOW,
    anon: asAppAnon,
    worker: (workerId) => (fn) => asWorker(workerId, fn),
    manager: asManager,
    revalidate: () => {},
    ...overrides,
  };
}
