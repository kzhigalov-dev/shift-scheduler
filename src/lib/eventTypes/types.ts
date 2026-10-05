import type { EventTag } from '@/lib/import/parseSheet';
export type EventType = {
  id: string; name: string; systemTag: EventTag | null; archived: boolean; sortOrder: number;
};
/** Без rate — старый клиент: оставить ставку как есть. null — убрать ставку вида. */
export type TypeSlotInput = { positionId: string; quantity: number; rate?: number | null };
export type TypeSlot = TypeSlotInput & { positionName: string; rate: number | null };
export type EventTypeSettings = EventType & { slots: TypeSlot[] };
export type TypeFormInput = { id: string | null; name: string; slots: TypeSlotInput[] };
export type EventTypeOption = { id: string; name: string; tag: EventTag };
export type TypeLookup = { id?: string; name?: string; systemTag?: EventTag; currentTypeId?: string };
