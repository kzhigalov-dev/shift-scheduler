import { MOSCOW_OFFSET_MIN } from '@/lib/calendar/ics';
import type { WorkerPrefs } from './prefs';

export type ReminderRow = { eventId: string; workerId: string; date: string; start: string; arrive: string | null; prefs: WorkerPrefs };
export type DueReminder = { kind: 'reminder_evening' | 'reminder_before'; eventId: string; workerId: string; hours?: number };

const pad = (n: number) => String(n).padStart(2, '0');

export function moscowNow(now: Date): { date: string; time: string } {
  const m = new Date(now.getTime() + MOSCOW_OFFSET_MIN * 60_000);
  return { date: m.toISOString().slice(0, 10), time: `${pad(m.getUTCHours())}:${pad(m.getUTCMinutes())}` };
}

/** Московские дата и время как момент UTC. */
function moscowInstant(date: string, time: string): number {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  return Date.UTC(y, mo - 1, d, h, mi) - MOSCOW_OFFSET_MIN * 60_000;
}

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * Какие напоминания пора поставить в очередь. Повторы гасит dedupe_key в очереди,
 * поэтому окно — целый час (вечер) и весь интервал «за N часов — до прихода».
 */
export function dueReminders(now: Date, rows: ReminderRow[]): DueReminder[] {
  const m = moscowNow(now);
  const due: DueReminder[] = [];
  for (const r of rows) {
    const arriveAt = moscowInstant(r.date, r.arrive ?? r.start);
    if (r.prefs.evening !== 'off' && r.date === addDays(m.date, 1) && m.time.slice(0, 2) === r.prefs.evening.slice(0, 2)) {
      due.push({ kind: 'reminder_evening', eventId: r.eventId, workerId: r.workerId });
    }
    if (r.prefs.before > 0) {
      const from = arriveAt - r.prefs.before * 3_600_000;
      if (now.getTime() >= from && now.getTime() < arriveAt) {
        // Сколько осталось на самом деле: назначили или включили напоминание уже внутри окна.
        const hours = Math.max(1, Math.round((arriveAt - now.getTime()) / 3_600_000));
        due.push({ kind: 'reminder_before', eventId: r.eventId, workerId: r.workerId, hours });
      }
    }
  }
  return due;
}
