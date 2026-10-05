import { describe, it, expect } from 'vitest';
import { dateInWords, pluralRu, formatDate, formatMoney, formatMoneyRange, formatFileSize, formatBotDay } from '@/lib/format';

const SHIFT_FORMS: [string, string, string] = ['смена', 'смены', 'смен'];

describe('pluralRu', () => {
  it('единственное число — 1, 21, 101', () => {
    expect(pluralRu(1, SHIFT_FORMS)).toBe('смена');
    expect(pluralRu(21, SHIFT_FORMS)).toBe('смена');
    expect(pluralRu(101, SHIFT_FORMS)).toBe('смена');
  });

  it('малое число — 2..4, 22..24', () => {
    expect(pluralRu(2, SHIFT_FORMS)).toBe('смены');
    expect(pluralRu(3, SHIFT_FORMS)).toBe('смены');
    expect(pluralRu(4, SHIFT_FORMS)).toBe('смены');
    expect(pluralRu(22, SHIFT_FORMS)).toBe('смены');
  });

  it('много или ноль — 0, 5..20, 11..14 даже с хвостом 1..4 в сотнях', () => {
    expect(pluralRu(0, SHIFT_FORMS)).toBe('смен');
    expect(pluralRu(5, SHIFT_FORMS)).toBe('смен');
    expect(pluralRu(11, SHIFT_FORMS)).toBe('смен');
    expect(pluralRu(12, SHIFT_FORMS)).toBe('смен');
    expect(pluralRu(14, SHIFT_FORMS)).toBe('смен');
    expect(pluralRu(25, SHIFT_FORMS)).toBe('смен');
    expect(pluralRu(111, SHIFT_FORMS)).toBe('смен');
  });
});

describe('formatDate', () => {
  it('без дня недели — только число и месяц', () => {
    expect(formatDate('2026-07-09')).toBe('9\u00a0июля');
    expect(formatDate('2026-01-01')).toBe('1\u00a0января');
    expect(formatDate('2026-12-31')).toBe('31\u00a0декабря');
  });

  it('weekday: short — сокращённый день недели', () => {
    expect(formatDate('2026-07-09', { weekday: 'short' })).toBe('Чт, 9\u00a0июля');
    expect(formatDate('2026-01-01', { weekday: 'short' })).toBe('Чт, 1\u00a0января');
    expect(formatDate('2026-12-31', { weekday: 'short' })).toBe('Чт, 31\u00a0декабря');
  });

  it('weekday: long — полный день недели', () => {
    expect(formatDate('2026-07-09', { weekday: 'long' })).toBe('Четверг, 9\u00a0июля');
    expect(formatDate('2026-01-01', { weekday: 'long' })).toBe('Четверг, 1\u00a0января');
    expect(formatDate('2026-12-31', { weekday: 'long' })).toBe('Четверг, 31\u00a0декабря');
  });
});

describe('formatMoney', () => {
  it('рубли с разрядами по-русски и знаком ₽', () => {
    expect(formatMoney(0)).toBe('0\u00a0₽');
    expect(formatMoney(900)).toBe('900\u00a0₽');
    // И разряды, и знак ₽ отделены неразрывным пробелом (U+00A0).
    expect(formatMoney(1300)).toBe('1\u00a0300\u00a0₽');
    expect(formatMoney(1234567)).toBe('1\u00a0234\u00a0567\u00a0₽');
  });
});

describe('неразрывные пробелы', () => {
  it('деньги не разрываются', () => {
    expect(formatMoney(1300)).toBe('1\u00a0300\u00a0₽');
    expect(formatMoney(364300)).toBe('364\u00a0300\u00a0₽');
    expect(formatMoney(0)).toBe('0\u00a0₽');
  });

  it('число и месяц не разрываются', () => {
    expect(formatDate('2026-07-09')).toBe('9\u00a0июля');
    expect(formatDate('2026-07-09', { weekday: 'short' })).toBe('Чт, 9\u00a0июля');
    expect(formatDate('2026-12-31', { weekday: 'long' })).toBe('Четверг, 31\u00a0декабря');
  });
});

describe('formatFileSize', () => {
  it('до мегабайта — целые килобайты', () => {
    expect(formatFileSize(678 * 1024)).toBe('678\u00a0КБ');
    expect(formatFileSize(1500)).toBe('1\u00a0КБ');
    expect(formatFileSize(1023 * 1024)).toBe('1023\u00a0КБ');
  });

  it('меньше килобайта — байты', () => {
    expect(formatFileSize(0)).toBe('0\u00a0Б');
    expect(formatFileSize(512)).toBe('512\u00a0Б');
  });

  it('от мегабайта — с одним знаком после запятой', () => {
    expect(formatFileSize(1.2 * 1024 * 1024)).toBe('1,2\u00a0МБ');
    expect(formatFileSize(1024 * 1024)).toBe('1\u00a0МБ');
    expect(formatFileSize(1023.7 * 1024)).toBe('1\u00a0МБ');
    expect(formatFileSize(4 * 1024 * 1024 - 1)).toBe('4\u00a0МБ');
  });
});

describe('formatBotDay', () => {
  it('день недели с маленькой буквы, число и месяц неразрывно', () => {
    expect(formatBotDay('2099-07-10')).toBe('пт, 10 июля');
    expect(formatBotDay('2099-07-10', 'short')).toBe('пт, 10 июл.');
    expect(formatBotDay('2026-05-05', 'short')).toBe('вт, 5 мая');
  });
});

describe('formatCount', () => {
  it('соединяет число со склонённой единицей', async () => {
    const { formatCount } = await import('@/lib/format');
    expect([0,1,2,11].map(n=>formatCount(n,['человек','человека','человек'])))
      .toEqual(['0\u00a0человек','1\u00a0человек','2\u00a0человека','11\u00a0человек']);
  });
});

describe('dateInWords — дата словами', () => {
  const NB = ' ';
  it('сегодня и завтра', () => {
    expect(dateInWords('2026-10-03', '2026-10-03')).toBe('сегодня');
    expect(dateInWords('2026-10-04', '2026-10-03')).toBe('завтра');
  });

  it('дальше — день недели в винительном и дата', () => {
    expect(dateInWords('2026-10-10', '2026-10-03')).toBe(`в${NB}субботу, 10${NB}октября`);
    expect(dateInWords('2026-10-05', '2026-10-03')).toBe(`в${NB}понедельник, 5${NB}октября`);
    expect(dateInWords('2026-10-06', '2026-10-03')).toBe(`во${NB}вторник, 6${NB}октября`);
    expect(dateInWords('2026-10-07', '2026-10-03')).toBe(`в${NB}среду, 7${NB}октября`);
    expect(dateInWords('2026-10-08', '2026-10-03')).toBe(`в${NB}четверг, 8${NB}октября`);
    expect(dateInWords('2026-10-09', '2026-10-03')).toBe(`в${NB}пятницу, 9${NB}октября`);
    expect(dateInWords('2026-10-11', '2026-10-03')).toBe(`в${NB}воскресенье, 11${NB}октября`);
  });

  it('завтра через границу месяца и года', () => {
    expect(dateInWords('2026-11-01', '2026-10-31')).toBe('завтра');
    expect(dateInWords('2027-01-01', '2026-12-31')).toBe('завтра');
  });

  it('другой год — с годом', () => {
    expect(dateInWords('2027-01-08', '2026-12-30')).toBe(`в${NB}пятницу, 8${NB}января 2027`);
  });
});

describe('formatMoneyRange', () => {
  it('одна сумма или «от–до» с неразрывными пробелами', () => {
    expect(formatMoneyRange({ min: 2000, max: 2000 })).toBe('2 000 ₽');
    expect(formatMoneyRange({ min: 1500, max: 2000 })).toBe('1 500–2 000 ₽');
  });
});
