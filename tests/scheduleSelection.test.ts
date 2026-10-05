import { describe, it, expect } from 'vitest';
import { parseCreateSelection, parseUpdateSelection } from '@/lib/schedule/selection';

describe('выбор мероприятий из браузера', () => {
  it('создание — список ключей', () => {
    expect(parseCreateSelection('{"keys":["2099-07-03|20:00"]}')).toEqual({ keys: ['2099-07-03|20:00'] });
  });

  it('повторная загрузка — три списка', () => {
    expect(parseUpdateSelection('{"add":["a"],"change":[],"remove":["b"]}'))
      .toEqual({ add: ['a'], change: [], remove: ['b'] });
  });

  it('мусор — понятная ошибка', () => {
    for (const raw of ['', 'null', '[]', '{"keys":"x"}', '{"keys":[1]}', '{"add":[],"change":[]}']) {
      expect(() => (raw.includes('add') ? parseUpdateSelection(raw) : parseCreateSelection(raw)))
        .toThrow('Некорректный выбор мероприятий');
    }
    expect(() => parseCreateSelection(JSON.stringify({ keys: Array.from({ length: 501 }, (_, i) => String(i)) })))
      .toThrow('Некорректный выбор мероприятий');
  });
});
