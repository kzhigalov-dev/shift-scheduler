import { describe, it, expect } from 'vitest';
import {
  normalize, isArtZerno, classifyTag, autoArriveTime, resolveArrive,
} from '@/lib/schedule/rules';

describe('normalize', () => {
  it('регистр, ё и пробелы', () => {
    expect(normalize('  Ночной  ОРГАН\nв Анненкирхе ')).toBe('ночной орган в анненкирхе');
    expect(normalize('Идёт')).toBe('идет');
  });
});

describe('isArtZerno', () => {
  it('все написания Арт-Зерна', () => {
    for (const s of ['арт-зерно', 'Арт-Зерно', 'арт-зерно2', ' АРТ-ЗЕРНО ']) expect(isArtZerno(s)).toBe(true);
    for (const s of ['аккорд', 'арт&аккорд', 'Арт&Аккорд', 'приход', '', 'Арт-Зерно (в)\nАккорд (н)'.slice(9)]) expect(isArtZerno(s)).toBe(false);
  });
});

describe('classifyTag — правила по порядку', () => {
  it('ужин → седер, экскурсия → экскурсия — раньше названия и времени', () => {
    expect(classifyTag('ужин', 'Тайная вечеря', '20:00')).toBe('seder');
    expect(classifyTag('экскурсия', 'Ночная экскурсия', '22:30')).toBe('excursion');
  });

  it('часовня, органный вторник, ночной, обычный', () => {
    expect(classifyTag('концерт', 'Концерт в часовне', '22:30')).toBe('chapel');
    expect(classifyTag('концерт', ' Органный вторник под луной', '20:00')).toBe('organ');
    expect(classifyTag('концерт', 'Вивальди', '22:00')).toBe('night');
    expect(classifyTag('концерт', 'НОЧНОЙ Вивальди', '21:00')).toBe('night');
    expect(classifyTag('концерт', 'Лунный свет', '21:59')).toBe('regular');
  });
});

describe('autoArriveTime', () => {
  it('смещения по типу', () => {
    expect(autoArriveTime('regular', '20:00')).toBe('18:00');
    expect(autoArriveTime('chapel', '20:30')).toBe('18:30');
    expect(autoArriveTime('organ', '20:00')).toBe('18:00');
    expect(autoArriveTime('seder', '20:00')).toBe('18:00');
    expect(autoArriveTime('night', '22:30')).toBe('21:00');
    expect(autoArriveTime('excursion', '21:00')).toBe('20:30');
  });

  it('через полночь', () => {
    expect(autoArriveTime('regular', '01:00')).toBe('23:00');
  });
});

describe('resolveArrive', () => {
  const auto = { startTime: '20:00', arriveTime: '18:00', manual: false };
  const manual = { startTime: '20:00', arriveTime: '17:30', manual: true };

  it('новое событие: пусто — авто, значение — ручной', () => {
    expect(resolveArrive(null, { startTime: '20:00', arriveTime: null, tag: 'regular' }))
      .toEqual({ arriveTime: '18:00', manual: false });
    expect(resolveArrive(null, { startTime: '20:00', arriveTime: '17:00', tag: 'regular' }))
      .toEqual({ arriveTime: '17:00', manual: true });
  });

  it('приход не трогали: авто пересчитывается, ручной остаётся', () => {
    expect(resolveArrive(auto, { startTime: '21:00', arriveTime: '18:00', tag: 'regular' }))
      .toEqual({ arriveTime: '19:00', manual: false });
    expect(resolveArrive(manual, { startTime: '21:00', arriveTime: '17:30', tag: 'regular' }))
      .toEqual({ arriveTime: '17:30', manual: true });
  });

  it('правка прихода — ручной; пустой — снова авто', () => {
    expect(resolveArrive(auto, { startTime: '20:00', arriveTime: '19:00', tag: 'regular' }))
      .toEqual({ arriveTime: '19:00', manual: true });
    expect(resolveArrive(manual, { startTime: '20:00', arriveTime: null, tag: 'night' }))
      .toEqual({ arriveTime: '18:30', manual: false });
  });
});
