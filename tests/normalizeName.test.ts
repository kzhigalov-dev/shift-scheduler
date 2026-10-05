import { describe, it, expect } from 'vitest';
import { cleanName, nameKey } from '@/lib/import/normalizeName';

describe('cleanName', () => {
  it('срезает звёздочки', () => {
    expect(cleanName('Андрей Макетный*')).toBe('Андрей Макетный');
    expect(cleanName('Кирилл Демонстрационный**')).toBe('Кирилл Демонстрационный');
  });

  it('схлопывает пробелы', () => {
    expect(cleanName('  Демоработник  ')).toBe('Демоработник');
    expect(cleanName('Илья   Примерный')).toBe('Илья Примерный');
  });
});

describe('nameKey', () => {
  it('склеивает варианты одного человека', () => {
    expect(nameKey('Кирилл Демонстрационный**')).toBe(nameKey('Кирилл Демонстрационный'));
    expect(nameKey('Демоработник ')).toBe(nameKey('Демоработник'));
  });

  it('игнорирует регистр и ё', () => {
    expect(nameKey('Семён Шаблонов')).toBe(nameKey('семен шаблонов'));
  });

  it('не путает разных людей', () => {
    expect(nameKey('Полина Фиктивная')).not.toBe(nameKey('Полина Демонстрационная'));
  });

  it('считает перестановку фамилии и имени одним человеком', () => {
    expect(nameKey('Демонстрационная Полина')).toBe(nameKey('Полина Демонстрационная'));
  });

  it('даёт конкретный ключ', () => {
    expect(nameKey('Кирилл Демонстрационный**')).toBe('демонстрационный кирилл');
  });
});
