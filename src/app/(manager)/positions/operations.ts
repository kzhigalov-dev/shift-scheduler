import type { Tx } from '@/db/client';
import { UserError } from '@/lib/errors';
import { checkQuantity } from '@/lib/quantity';

export type PositionRow = {
  id: string;
  name: string;
  defaultQuantity: number;
  defaultRate: number | null;
};

export async function listPositions(tx: Tx): Promise<PositionRow[]> {
  const rows = await tx<Array<{
    id: string; name: string; default_quantity: number; default_rate: number | null;
  }>>`select id, name, default_quantity, default_rate from position order by sort_order`;
  return rows.map((r) => ({
    id: r.id, name: r.name, defaultQuantity: r.default_quantity, defaultRate: r.default_rate,
  }));
}

/** Меняет шаблон должности. Слоты уже созданных событий не трогаются. */
export async function updatePosition(
  tx: Tx,
  { id, defaultQuantity, defaultRate }:
    { id: string; defaultQuantity: number; defaultRate: number | null },
): Promise<void> {
  checkQuantity(defaultQuantity);
  const [row] = await tx`update position set default_quantity = ${defaultQuantity}, default_rate = ${defaultRate}
           where id = ${id} returning id`;
  if (!row) throw new UserError('Должность не найдена — обновите страницу');
}
