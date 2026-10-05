/** iCalendar (RFC 5545) для подписок на смены и мероприятия. Чистые функции. */

export const CALENDAR_LOCATION = 'Анненкирхе, Кирочная ул., 8, Санкт-Петербург';
/** Конца у мероприятий в базе нет: в календаре — начало + 90 минут. */
export const EVENT_MINUTES = 90;
/** Москва — UTC+3 круглый год (перехода на летнее время нет с 2014). */
export const MOSCOW_OFFSET_MIN = 180;

export type IcsEvent = {
  uid: string;
  date: string;
  startTime: string;
  endDate: string;
  endTime: string;
  summary: string;
  description: string;
  location: string;
};

export function icsEscape(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');
}

/** Перенос длинной строки: не больше 75 октетов на строку, продолжение — с пробела. */
export function foldLine(line: string): string {
  const parts: string[] = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const size = Buffer.byteLength(ch, 'utf8');
    const limit = parts.length === 0 ? 75 : 74; // у продолжения первый октет — пробел
    if (bytes + size > limit) {
      parts.push(current);
      current = '';
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  parts.push(current);
  return parts.map((p, i) => (i === 0 ? p : ` ${p}`)).join('\r\n');
}

const pad = (n: number) => String(n).padStart(2, '0');

function utcParts(date: string, time: string, extraMinutes = 0): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh, mm + extraMinutes));
}

/** Московские дата и время → `YYYYMMDDTHHMMSSZ`. */
export function moscowToUtc(date: string, time: string): string {
  const t = utcParts(date, time, -MOSCOW_OFFSET_MIN);
  return `${t.getUTCFullYear()}${pad(t.getUTCMonth() + 1)}${pad(t.getUTCDate())}T${pad(t.getUTCHours())}${pad(t.getUTCMinutes())}00Z`;
}

/** Сдвиг московского времени на N минут (через полночь — следующий день). */
export function addMinutes(date: string, time: string, minutes: number): { date: string; time: string } {
  const t = utcParts(date, time, minutes);
  return {
    date: `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`,
    time: `${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`,
  };
}

function stamp(now: Date): string {
  return `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
}

export function buildCalendar({ name, events, now }: { name: string; events: IcsEvent[]; now: Date }): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Annenkirche Shifts//RU',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsEscape(name)}`,
    'X-WR-TIMEZONE:Europe/Moscow',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
  ];
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}`,
      `DTSTAMP:${stamp(now)}`,
      `DTSTART:${moscowToUtc(e.date, e.startTime)}`,
      `DTEND:${moscowToUtc(e.endDate, e.endTime)}`,
      `SUMMARY:${icsEscape(e.summary)}`,
      `DESCRIPTION:${icsEscape(e.description)}`,
      `LOCATION:${icsEscape(e.location)}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}
