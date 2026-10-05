import type { ScheduleEvent } from '@/lib/schedule/parseSchedule';
import { autoArriveTime } from '@/lib/schedule/rules';

/** Строка расписания для тестов: Арт-Зерно, концерт, без замечаний. */
export function ev(date: string, startTime: string, title: string, over: Partial<ScheduleEvent> = {}): ScheduleEvent {
  const tag = over.tag ?? 'regular';
  return {
    key: `${date}|${startTime}`, row: 3, date, startTime, title, tag,
    arriveTime: autoArriveTime(tag, startTime), comment: null,
    organizer: 'арт-зерно', direction: 'концерт', checked: true, issue: null,
    ...over,
  };
}
