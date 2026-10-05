import { UserError } from '@/lib/errors';
import type { DiffSelection } from '@/lib/monthPlan/months';

/** Граница ввода: выбор строк приходит из браузера JSON-ом (`unknown` здесь оправдан). */
const BAD = 'Некорректный выбор мероприятий';
const MAX_ITEMS = 500;

function object(raw: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new UserError(BAD);
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new UserError(BAD);
  return value as Record<string, unknown>;
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_ITEMS || !value.every((v) => typeof v === 'string')) {
    throw new UserError(BAD);
  }
  return value;
}

export function parseCreateSelection(raw: string): { keys: string[] } {
  return { keys: strings(object(raw).keys) };
}

export function parseUpdateSelection(raw: string): DiffSelection {
  const v = object(raw);
  return { add: strings(v.add), change: strings(v.change), remove: strings(v.remove) };
}
