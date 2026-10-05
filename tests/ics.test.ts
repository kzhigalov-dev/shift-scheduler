import { describe, it, expect } from 'vitest';
import {
  addMinutes, buildCalendar, CALENDAR_LOCATION, foldLine, icsEscape, moscowToUtc,
} from '@/lib/calendar/ics';

describe('icsEscape', () => {
  it('экранирует \\ ; , и переводы строк', () => {
    expect(icsEscape('a\\b;c,d\ne')).toBe('a\\\\b\\;c\\,d\\ne');
  });
  it('одиночный CR и CRLF — тоже перевод строки', () => {
    expect(icsEscape('a\rb\r\nc\nd')).toBe('a\\nb\\nc\\nd');
  });
});

describe('foldLine', () => {
  it('короткую строку не трогает', () => {
    expect(foldLine('SUMMARY:Смена')).toBe('SUMMARY:Смена');
  });
  it('режет по 75 октетов, не ломая кириллицу', () => {
    const line = `DESCRIPTION:${'Ж'.repeat(80)}`;
    const folded = foldLine(line);
    const parts = folded.split('\r\n');
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(Buffer.byteLength(p, 'utf8')).toBeLessThanOrEqual(75);
    expect(parts.slice(1).every((p) => p.startsWith(' '))).toBe(true);
    expect(parts.map((p, i) => (i === 0 ? p : p.slice(1))).join('')).toBe(line);
  });
});

describe('foldLine: октеты', () => {
  const check = (line: string) => {
    const folded = foldLine(line);
    const parts = folded.split('\r\n');
    for (const p of parts) expect(Buffer.byteLength(p, 'utf8')).toBeLessThanOrEqual(75);
    expect(parts.map((p, i) => (i === 0 ? p : p.slice(1))).join('')).toBe(line);
    return parts;
  };
  it('3-байтовые символы не ломаются', () => {
    const parts = check(`SUMMARY:${'€'.repeat(60)}`);
    expect(parts.length).toBeGreaterThan(1);
  });
  it('эмодзи (4 байта, суррогатная пара) не ломаются', () => {
    const parts = check(`SUMMARY:${'😀'.repeat(40)}`);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p).not.toMatch(/\p{Surrogate}/u);
  });
  it('строка ровно в 75 октетов не переносится', () => {
    const line = `X:${'a'.repeat(73)}`;
    expect(Buffer.byteLength(line, 'utf8')).toBe(75);
    expect(foldLine(line)).toBe(line);
    expect(foldLine(`${line}a`).split('\r\n')).toHaveLength(2);
  });
});

describe('время', () => {
  it('Москва → UTC', () => {
    expect(moscowToUtc('2026-10-03', '20:00')).toBe('20261003T170000Z');
    expect(moscowToUtc('2026-10-03', '01:30')).toBe('20261002T223000Z');
  });
  it('addMinutes через полночь', () => {
    expect(addMinutes('2026-10-03', '22:30', 90)).toEqual({ date: '2026-10-04', time: '00:00' });
    expect(addMinutes('2026-10-03', '20:00', 90)).toEqual({ date: '2026-10-03', time: '21:30' });
  });
});

describe('buildCalendar', () => {
  const now = new Date(Date.UTC(2026, 8, 30, 9, 15, 0));
  const text = buildCalendar({
    name: 'Мои смены · Анненкирхе',
    now,
    events: [{
      uid: 'shift-e1-w1@annenkirche-shifts', date: '2026-10-03', startTime: '18:00',
      endDate: '2026-10-03', endTime: '21:30', summary: 'Смена · БИЛЕТЫ · Лунный свет',
      description: 'Начало: 20:00\nСтавка: 1 300 ₽', location: CALENDAR_LOCATION,
    }],
  });

  it('заголовок календаря и одно событие', () => {
    // Строки сравниваем после разворачивания переносов (RFC 5545 §3.1): LOCATION длиннее 75 октетов.
    const lines = text.replace(/\r\n /g, '').split('\r\n');
    expect(lines[0]).toBe('BEGIN:VCALENDAR');
    expect(lines).toContain('VERSION:2.0');
    expect(lines).toContain('X-WR-CALNAME:Мои смены · Анненкирхе');
    expect(lines).toContain('X-WR-TIMEZONE:Europe/Moscow');
    expect(lines).toContain('REFRESH-INTERVAL;VALUE=DURATION:PT1H');
    expect(lines).toContain('BEGIN:VEVENT');
    expect(lines).toContain('UID:shift-e1-w1@annenkirche-shifts');
    expect(lines).toContain('DTSTAMP:20260930T091500Z');
    expect(lines).toContain('DTSTART:20261003T150000Z');
    expect(lines).toContain('DTEND:20261003T183000Z');
    expect(lines).toContain('SUMMARY:Смена · БИЛЕТЫ · Лунный свет');
    expect(lines).toContain('LOCATION:Анненкирхе\\, Кирочная ул.\\, 8\\, Санкт-Петербург');
    expect(lines.at(-2)).toBe('END:VCALENDAR');
    expect(text.endsWith('\r\n')).toBe(true);
  });

  it('описание с переводами строк экранировано', () => {
    expect(text).toContain('DESCRIPTION:Начало: 20:00\\nСтавка: 1 300 ₽');
  });

  it('«;» в названии выводится как литеральный \\;', () => {
    const t = buildCalendar({
      name: 'X', now,
      events: [{
        uid: 'u', date: '2026-10-03', startTime: '18:00', endDate: '2026-10-03', endTime: '19:00',
        summary: 'Смена; вечер', description: '', location: '',
      }],
    });
    expect(t.replace(/\r\n /g, '')).toContain('SUMMARY:Смена\\; вечер');
  });

  it('пустой календарь валиден', () => {
    const empty = buildCalendar({ name: 'X', now, events: [] });
    expect(empty).toContain('BEGIN:VCALENDAR');
    expect(empty).not.toContain('BEGIN:VEVENT');
  });
});
