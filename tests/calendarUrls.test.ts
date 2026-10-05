import { describe, it, expect } from 'vitest';
import { feedUrls, moscowDateMinusDays, originFromHeaders } from '@/lib/calendar/urls';

describe('originFromHeaders', () => {
  it('прокси Vercel', () => {
    const h = new Headers({ 'x-forwarded-host': 'annenkirche-shifts.vercel.app', 'x-forwarded-proto': 'https', host: 'internal' });
    expect(originFromHeaders(h)).toBe('https://annenkirche-shifts.vercel.app');
  });
  it('локально — http, без заголовков прокси — https', () => {
    expect(originFromHeaders(new Headers({ host: 'localhost:3100' }))).toBe('http://localhost:3100');
    expect(originFromHeaders(new Headers({ host: 'example.org' }))).toBe('https://example.org');
  });
});

describe('originFromHeaders: проверка заголовков', () => {
  it('берёт первое значение списка через запятую', () => {
    const h = new Headers({ 'x-forwarded-host': 'a.app, b.app', 'x-forwarded-proto': 'https, http', host: 'internal' });
    expect(originFromHeaders(h)).toBe('https://a.app');
  });
  it('неизвестный протокол заменяется по умолчанию', () => {
    expect(originFromHeaders(new Headers({ 'x-forwarded-proto': 'javascript', host: 'example.org' }))).toBe('https://example.org');
    expect(originFromHeaders(new Headers({ 'x-forwarded-proto': 'ftp', host: 'localhost:3100' }))).toBe('http://localhost:3100');
  });
  it('некорректный x-forwarded-host заменяется на host, затем на localhost', () => {
    expect(originFromHeaders(new Headers({ 'x-forwarded-host': 'evil.com/path?x=1', host: 'example.org' }))).toBe('https://example.org');
    expect(originFromHeaders(new Headers({ 'x-forwarded-host': 'a b', host: 'bad host' }))).toBe('http://localhost');
    expect(originFromHeaders(new Headers())).toBe('http://localhost');
  });
});

describe('feedUrls', () => {
  it('https, webcal и Google', () => {
    const u = feedUrls('https://a.app', '/cal/tok.ics');
    expect(u.https).toBe('https://a.app/cal/tok.ics');
    expect(u.webcal).toBe('webcal://a.app/cal/tok.ics');
    expect(u.google).toBe(`https://calendar.google.com/calendar/r?cid=${encodeURIComponent('webcal://a.app/cal/tok.ics')}`);
  });
});

describe('moscowDateMinusDays', () => {
  it('по московской дате', () => {
    // 22:30 UTC 30 сентября — в Москве уже 1 октября.
    expect(moscowDateMinusDays(new Date(Date.UTC(2026, 8, 30, 22, 30)), 60)).toBe('2026-08-02');
  });
});
