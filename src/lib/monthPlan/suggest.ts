import { cleanName, nameKey } from '@/lib/import/normalizeName';
import { normalize } from '@/lib/schedule/rules';
import type { PlanPerson } from './plan';

export type Suggestion =
  | { kind: 'worker'; id: string; fullName: string; shifts: number; signup: boolean; busy: string | null }
  | { kind: 'new'; name: string };

export const MAX_SUGGESTIONS = 8;

/**
 * Подсказки для ячейки таблицы. Подавшие заявку — первыми, дальше по алфавиту.
 * `busy` — должность, на которой человек уже стоит на этом мероприятии.
 * В конце — «Добавить работника», если точного совпадения по имени нет.
 */
export function suggest(query: string, ctx: {
  workers: PlanPerson[];
  signups: ReadonlySet<string>;
  shifts: ReadonlyMap<string, number>;
  busy: ReadonlyMap<string, string>;
}): Suggestion[] {
  const words = normalize(query).split(' ').filter(Boolean);
  const list: Suggestion[] = ctx.workers
    .filter((w) => words.every((word) => normalize(w.fullName).includes(word)))
    .map((w) => ({
      kind: 'worker' as const, id: w.workerId, fullName: w.fullName,
      shifts: ctx.shifts.get(w.workerId) ?? 0, signup: ctx.signups.has(w.workerId),
      busy: ctx.busy.get(w.workerId) ?? null,
    }))
    .sort((a, b) => Number(b.signup) - Number(a.signup) || a.fullName.localeCompare(b.fullName, 'ru'))
    .slice(0, MAX_SUGGESTIONS);
  const name = cleanName(query);
  if (name && !ctx.workers.some((w) => nameKey(w.fullName) === nameKey(name))) list.push({ kind: 'new', name });
  return list;
}
