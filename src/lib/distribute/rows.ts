import { UserError } from '@/lib/errors';
import { isUuid } from '@/lib/ids';

/** Строка распределения из окна: человек на мероприятии → должность (`null` — без должности). */
export type DistributionRow = { eventId: string; workerId: string; positionId: string | null };

/** Больше строк окно не присылает: в месяце столько людей без должности не бывает. */
export const MAX_ROWS = 500;
const BAD = 'Некорректный запрос';

/**
 * Граница ввода: строки приходят из браузера (`unknown` здесь оправдан). Только форма и uuid —
 * всё остальное (человек на мероприятии, место, не АДМИН) проверяется заново в транзакции.
 */
export function parseDistributionRows(value: unknown): DistributionRow[] {
  if (!Array.isArray(value) || value.length > MAX_ROWS) throw new UserError(BAD);
  return value.map((item: unknown) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) throw new UserError(BAD);
    const { eventId, workerId, positionId } = item as Record<string, unknown>;
    if (!isUuid(eventId) || !isUuid(workerId) || !(positionId === null || isUuid(positionId))) throw new UserError(BAD);
    return { eventId, workerId, positionId };
  });
}
