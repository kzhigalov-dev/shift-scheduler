/** Должность, которую распределение никогда не заполняет. */
export const ADMIN = 'АДМИН';

/** Свободные места должности на мероприятии: `free` = мест − людей на ней. */
export type FreeSlot = { positionId: string; name: string; free: number };
/** Человек → должность; `null` — остаётся без должности. */
export type Placement = { workerId: string; positionId: string | null };
/** Целое в [0, max). На сервере — `crypto.randomInt`, в тестах — повторяемый источник. */
export type RandomInt = (max: number) => number;
export type OverLimit = { positionId: string; name: string; free: number; chosen: number };

/** Перемешивание Фишера — Йетса; вход не меняется. */
export function shuffle<T>(items: readonly T[], random: RandomInt): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = random(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Случайная расстановка: люди перемешиваются и по очереди занимают случайные свободные места
 * (место — один человек). АДМИН не заполняется. Лишние люди — без должности, лишние места — свободны.
 * Строки — в порядке `people`.
 */
export function distribute(people: readonly string[], freeSlots: readonly FreeSlot[], random: RandomInt): Placement[] {
  const order = shuffle(people, random);
  const seats = shuffle(freeSlots
    .filter((s) => s.name !== ADMIN)
    .flatMap((s) => Array.from({ length: Math.max(0, s.free) }, () => s.positionId)), random);
  const seatOf = new Map(order.map((workerId, i) => [workerId, seats[i] ?? null]));
  return people.map((workerId) => ({ workerId, positionId: seatOf.get(workerId) ?? null }));
}

/**
 * Должности мероприятия, выбранные большему числу людей, чем на них свободных мест.
 * АДМИН считается без мест. Должности не из `free` не проверяются — их отсеет сервер.
 */
export function overLimit(rows: ReadonlyArray<{ positionId: string | null }>, free: readonly FreeSlot[]): OverLimit[] {
  const chosen = new Map<string, number>();
  for (const r of rows) if (r.positionId !== null) chosen.set(r.positionId, (chosen.get(r.positionId) ?? 0) + 1);
  return free.flatMap((s) => {
    const limit = s.name === ADMIN ? 0 : Math.max(0, s.free);
    const n = chosen.get(s.positionId) ?? 0;
    return n > limit ? [{ positionId: s.positionId, name: s.name, free: limit, chosen: n }] : [];
  });
}

/** «На БИЛЕТЫ мест: 3». */
export function overLimitLabel({ name, free }: Pick<OverLimit, 'name' | 'free'>): string {
  return `На ${name} мест: ${free}`;
}
