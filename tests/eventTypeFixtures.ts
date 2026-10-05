import type { Tx } from '@/db/client';
import type { EventInput } from '@/lib/events';
import { defaultTypeSlots } from '@/lib/eventTypes/operations';
import type { TypeSlotInput } from '@/lib/eventTypes/types';
export const eventInput: EventInput = {
  date:'2099-10-01',startTime:'20:00',arriveTime:null,concert:'Тестовый концерт',
  tag:'regular',baseRate:1300,comment:null,
};
export async function slotsFor(tx: Tx, quantities: Record<string,number>): Promise<TypeSlotInput[]> {
  return (await defaultTypeSlots(tx)).map(s=>({positionId:s.positionId,quantity:quantities[s.positionName]??0}));
}
