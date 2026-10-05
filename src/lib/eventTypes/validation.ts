import { UserError } from '@/lib/errors';
import { isUuid } from '@/lib/ids';
import { parseQuantity, checkQuantity } from '@/lib/quantity';
import { parseRate } from '@/lib/events';
import type { TypeFormInput, TypeSlotInput } from './types';

export function normalizeTypeName(raw: string): { name: string; key: string } {
  const name = raw.trim().replace(/\s+/g, ' ');
  if (Array.from(name).length < 1 || Array.from(name).length > 80) {
    throw new UserError('Название — от 1 до 80 символов');
  }
  return { name, key: name.toLowerCase().replace(/ё/g, 'е') };
}
export function parseTypeForm(form: FormData): TypeFormInput {
  const rawId = form.get('id');
  const id = rawId === null || rawId === '' ? null : rawId;
  if (id !== null && !isUuid(id)) throw new UserError('Некорректный вид мероприятия');
  const rawName = form.get('name');
  if (typeof rawName !== 'string' || form.getAll('name').length !== 1 || form.getAll('id').length > 1) {
    throw new UserError('Укажите название вида');
  }
  const { name } = normalizeTypeName(rawName);
  const slots: TypeSlotInput[] = [];
  for (const key of new Set(form.keys())) {
    if (!key.startsWith('quantity:')) continue;
    const positionId = key.slice('quantity:'.length);
    if (!isUuid(positionId) || form.getAll(key).length !== 1) throw new UserError('Некорректная должность');
    const quantity = parseQuantity(form.get(key));
    checkQuantity(quantity);
    const rateKey = `rate:${positionId}`;
    if (form.getAll(rateKey).length > 1 || (form.has(rateKey) && typeof form.get(rateKey) !== 'string')) {
      throw new UserError('Некорректная ставка должности');
    }
    slots.push({ positionId, quantity, ...(form.has(rateKey) ? { rate: parseRate(form.get(rateKey)) } : {}) });
  }
  const ids = new Set(slots.map(s => s.positionId));
  for (const key of form.keys()) {
    if (key.startsWith('rate:') && !ids.has(key.slice('rate:'.length))) throw new UserError('Некорректная должность');
  }
  return { id, name, slots };
}
