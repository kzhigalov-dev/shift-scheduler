import type { EventTag } from '@/lib/import/parseSheet';

/** Для сравнений: строчные, «ё» → «е», пробелы и переводы строк схлопнуты, края обрезаны. */
export function normalize(text: string): string {
  return text.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

export const ANNENKIRCHE = 'анненкирхе';

/** Направления, которые по умолчанию — смены команды. */
export const SHIFT_DIRECTIONS = ['концерт', 'ужин', 'экскурсия'] as const;

/** «арт-зерно», «Арт-Зерно», «арт-зерно2» — один организатор. */
export function isArtZerno(organizer: string): boolean {
  return normalize(organizer).startsWith('арт-зерно');
}

/** Тип мероприятия по правилам спецификации — по порядку, первое совпадение. */
export function classifyTag(direction: string, title: string, startTime: string): EventTag {
  const d = normalize(direction);
  const t = normalize(title);
  if (d === 'ужин') return 'seder';
  if (d === 'экскурсия') return 'excursion';
  if (t.includes('часовн')) return 'chapel';
  if (t.includes('органный вторник')) return 'organ';
  if (startTime >= '22:00' || t.includes('ночн')) return 'night';
  return 'regular';
}

/** За сколько минут до начала приходит команда. */
const ARRIVE_OFFSET_MIN: Record<EventTag, number> = {
  regular: 120, chapel: 120, organ: 120, seder: 120, night: 90, excursion: 30,
};

const pad = (n: number) => String(n).padStart(2, '0');

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function fromMinutes(total: number): string {
  const t = ((total % 1440) + 1440) % 1440;
  return `${pad(Math.floor(t / 60))}:${pad(t % 60)}`;
}

export function autoArriveTime(tag: EventTag, startTime: string): string {
  return fromMinutes(toMinutes(startTime) - ARRIVE_OFFSET_MIN[tag]);
}

export type ArriveState = { startTime: string; arriveTime: string | null; manual: boolean };

/**
 * Приход после создания или правки события. `next.arriveTime`:
 * null — автоматический; равен текущему — поле не трогали (автоматический
 * пересчитывается от нового начала и типа, ручной остаётся); другое
 * значение — ручная правка.
 */
export function resolveArrive(
  current: ArriveState | null,
  next: { startTime: string; arriveTime: string | null; tag: EventTag },
): { arriveTime: string; manual: boolean } {
  const auto = { arriveTime: autoArriveTime(next.tag, next.startTime), manual: false };
  if (next.arriveTime === null) return auto;
  if (current && next.arriveTime === current.arriveTime) {
    return current.manual ? { arriveTime: next.arriveTime, manual: true } : auto;
  }
  return { arriveTime: next.arriveTime, manual: true };
}
