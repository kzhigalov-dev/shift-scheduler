export type RateLevels = {
  /** Личная ставка человека на этой смене. */
  personRate: number | null;
  /** Ставка должности на этом концерте. */
  slotRate: number | null;
  /** Ставка должности по умолчанию. */
  positionRate: number | null;
  /** Ставка концерта. */
  eventRate: number | null;
};

export type PayInput = RateLevels & { workerId: string; fullName: string };

export type PayRow = {
  workerId: string;
  fullName: string;
  shifts: number;
  total: number;
  /** Смены, для которых не задана ни одна ставка. */
  unpriced: number;
};

/** Первая заполненная ставка от частного к общему. Явный 0 — это 0. */
export function shiftAmount(r: RateLevels): number | null {
  return r.personRate ?? r.slotRate ?? r.positionRate ?? r.eventRate ?? null;
}

export type RateRange = { min: number; max: number };

/**
 * Ставка, которую работник получит, — до назначения на должность (L6): по каждому месту мероприятия
 * той же `shiftAmount`, что и оплата, без личной ставки (её ещё нет). Мест нет — базовая ставка
 * мероприятия. Места без ставки в диапазон не входят; ставок нет вовсе — null («уточняется»).
 */
export function rateRange(
  slots: ReadonlyArray<Pick<RateLevels, 'slotRate' | 'positionRate'>>, eventRate: number | null,
): RateRange | null {
  const levels = slots.length > 0 ? slots : [{ slotRate: null, positionRate: null }];
  const amounts = levels
    .map((s) => shiftAmount({ personRate: null, slotRate: s.slotRate, positionRate: s.positionRate, eventRate }))
    .filter((a): a is number => a !== null);
  return amounts.length > 0 ? { min: Math.min(...amounts), max: Math.max(...amounts) } : null;
}

export function calculatePay(rows: PayInput[]): PayRow[] {
  const byWorker = new Map<string, PayRow>();

  for (const row of rows) {
    const acc = byWorker.get(row.workerId) ?? {
      workerId: row.workerId,
      fullName: row.fullName,
      shifts: 0,
      total: 0,
      unpriced: 0,
    };
    const amount = shiftAmount(row);
    acc.shifts += 1;
    if (amount === null) acc.unpriced += 1;
    else acc.total += amount;
    byWorker.set(row.workerId, acc);
  }

  return [...byWorker.values()].sort(
    (a, b) => b.total - a.total || a.fullName.localeCompare(b.fullName, 'ru'),
  );
}
