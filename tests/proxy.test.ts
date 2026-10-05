import { describe, it, expect, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy, config } from '@/proxy';

/** Прокси: перенос cookie прежних версий (L6/L7) — только для перехода на страницу. */
const request = (path: string, init: { method?: string; headers?: Record<string, string>; cookie?: string } = {}) =>
  new NextRequest(`https://annenshifts.example${path}`, {
    method: init.method ?? 'GET',
    headers: { 'sec-fetch-dest': 'document', accept: 'text/html', ...(init.cookie ? { cookie: init.cookie } : {}), ...init.headers },
  });

afterEach(() => vi.unstubAllEnvs());

describe('proxy: перенос старых cookie входа', () => {
  it('переход на страницу со старой worker_token — на /auth/upgrade с путём возврата, без кеша', () => {
    const res = proxy(request('/shifts?view=month', { cookie: 'worker_token=abc' }));
    expect(res.status).toBe(307);
    const target = new URL(res.headers.get('location') ?? '');
    expect(target.pathname).toBe('/auth/upgrade');
    expect(target.searchParams.get('to')).toBe('/shifts?view=month');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });

  it('на бою прежние имена без __Host- тоже переносятся; новые — нет', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(proxy(request('/month', { cookie: 'manager_session=m' })).status).toBe(307);
    expect(proxy(request('/shifts', { cookie: 'worker_session=s' })).status).toBe(307);
    expect(proxy(request('/month', { cookie: '__Host-manager_session=m' })).headers.get('location')).toBeNull();
  });

  it('локально имена без префикса — нынешние, их не трогаем', () => {
    expect(proxy(request('/month', { cookie: 'manager_session=m; worker_session=s' })).headers.get('location')).toBeNull();
  });

  it('запросы данных Next, prefetch, action, POST и загрузки — без перенаправления', () => {
    const cookie = 'worker_token=abc';
    for (const req of [
      request('/shifts', { cookie, headers: { rsc: '1' } }),
      request('/shifts', { cookie, headers: { 'next-router-prefetch': '1' } }),
      request('/shifts', { cookie, headers: { 'next-action': 'x' } }),
      request('/shifts', { cookie, method: 'POST' }),
      request('/shifts', { cookie, headers: { 'sec-fetch-dest': 'empty' } }),
    ]) {
      expect(proxy(req).headers.get('location')).toBeNull();
    }
  });

  it('вход, API, ленты и сам перенос — без перенаправления', () => {
    for (const path of ['/auth/upgrade?to=/x', '/api/import/preview', '/cal/k.ics', '/tg/app', '/w/t/confirm']) {
      expect(proxy(request(path, { cookie: 'worker_token=abc' })).headers.get('location')).toBeNull();
    }
  });

  it('matcher пропускает статику сборки и иконки', () => {
    const [source] = config.matcher;
    const re = new RegExp(`^${source}$`);
    expect(re.test('/_next/static/chunks/a.js')).toBe(false);
    expect(re.test('/favicon.ico')).toBe(false);
    expect(re.test('/icon-192.png')).toBe(false);
    expect(re.test('/shifts')).toBe(true);
    expect(re.test('/')).toBe(true);
  });
});
