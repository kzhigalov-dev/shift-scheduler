import { describe, it, expect } from 'vitest';
import { TAG_LABELS, TAG_OPTIONS, EVENT_TAGS } from '@/lib/eventTags';
import { parseEventForm } from '@/lib/events';

function form(tag: string): FormData {
  const f = new FormData();
  f.set('date', '2026-08-06');
  f.set('startTime', '20:00');
  f.set('tag', tag);
  return f;
}

describe('теги событий — один источник TAG_LABELS', () => {
  it('список тегов и варианты формы выводятся из TAG_LABELS', () => {
    expect(EVENT_TAGS).toEqual(Object.keys(TAG_LABELS));
    expect(TAG_OPTIONS).toEqual(EVENT_TAGS.map((value) => ({ value, label: TAG_LABELS[value] })));
  });

  it('форма события принимает каждый тег из списка и только их', () => {
    for (const tag of EVENT_TAGS) expect(parseEventForm(form(tag)).tag).toBe(tag);
    expect(() => parseEventForm(form('concert'))).toThrow('Неизвестный тип события');
  });
});
