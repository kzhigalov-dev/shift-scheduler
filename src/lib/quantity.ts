import { UserError } from '@/lib/errors';

/**
 * Верхняя граница числа людей на должности — задана координатором при
 * постановке задачи. Общая для шаблона должности и слота на событии.
 */
export const MAX_DEFAULT_QUANTITY = 20;

/** Пустая/пробельная строка — частая ошибка (Number('') === 0), а не «0 людей». */
export function parseQuantity(value: FormDataEntryValue | null): number {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s) throw new UserError('Укажите количество людей (0 — должность не нужна)');
  return Number(s);
}

/** Целое от 0 до MAX_DEFAULT_QUANTITY — иначе UserError. */
export function checkQuantity(quantity: number): void {
  if (!Number.isInteger(quantity) || quantity < 0 || quantity > MAX_DEFAULT_QUANTITY) {
    throw new UserError(`Количество — целое, от 0 до ${MAX_DEFAULT_QUANTITY}`);
  }
}
