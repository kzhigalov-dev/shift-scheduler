import type { EventTag } from '@/lib/import/parseSheet';

/** Подписи типов событий на русском — единый источник для списка и формы. */
export const TAG_LABELS: Record<EventTag, string> = {
  regular: 'обычное',
  chapel: 'часовня',
  night: 'ночной',
  seder: 'седер',
  organ: 'орган',
  excursion: 'экскурсия',
};

/** Все теги по порядку — ключи TAG_LABELS (Record<EventTag, …> не даст пропустить ни один). */
export const EVENT_TAGS = Object.keys(TAG_LABELS) as readonly EventTag[];

export const TAG_OPTIONS: ReadonlyArray<{ value: EventTag; label: string }> =
  EVENT_TAGS.map((value) => ({ value, label: TAG_LABELS[value] }));
