import { describe, it, expect } from 'vitest';
import {
  DEFAULT_MANAGER_PREFS, DEFAULT_WORKER_PREFS, parseManagerPrefs, parseWorkerPrefs,
} from '@/lib/telegram/prefs';
import * as msg from '@/lib/telegram/messages';
import { dueReminders, moscowNow } from '@/lib/telegram/reminders';

const shift = { date: '2026-10-03', start: '20:00', arrive: '18:00', concert: 'Лунный свет', position: 'БИЛЕТЫ' };

describe('настройки', () => {
  it('по умолчанию всё включено, напоминания 18:00 и за 3 часа', () => {
    expect(parseWorkerPrefs({})).toEqual(DEFAULT_WORKER_PREFS);
    expect(DEFAULT_WORKER_PREFS).toMatchObject({ assignments: true, free: true, evening: '18:00', before: 3 });
    expect(parseManagerPrefs(null)).toEqual(DEFAULT_MANAGER_PREFS);
  });
  it('берёт только допустимые значения', () => {
    expect(parseWorkerPrefs({ free: false, evening: '20:00', before: 2, x: 1 })).toMatchObject({ free: false, evening: '20:00', before: 2 });
    expect(parseWorkerPrefs({ free: 'нет', evening: '07:00', before: 5 })).toMatchObject({ free: true, evening: '18:00', before: 3 });
    expect(parseWorkerPrefs('мусор')).toEqual(DEFAULT_WORKER_PREFS);
  });
});

describe('тексты (HTML целиком)', () => {
  const lines = '🗓 Сб, 3 октября\n🕕 Приход 18:00 · начало 20:00\n🎵 Лунный свет';

  it('назначение, напоминания, время, оставили — со строкой должности', () => {
    expect(msg.assignedText(shift)).toBe(`✅ <b>Вас поставили на смену</b>\n${lines}\n👤 БИЛЕТЫ`);
    expect(msg.eveningReminderText(shift)).toBe(`⏰ <b>Завтра смена</b>\n${lines}\n👤 БИЛЕТЫ`);
    expect(msg.beforeReminderText(shift, 3)).toBe(`⏰ <b>Через 3 часа смена</b>\n${lines}\n👤 БИЛЕТЫ`);
    expect(msg.timeChangedText(shift)).toBe(`🔄 <b>Изменилось время смены</b>\n${lines}\n👤 БИЛЕТЫ`);
    expect(msg.keptText({ ...shift, position: null })).toBe(`📌 <b>Менеджер оставил вас на смене</b>\n${lines}\n👤 Без должности`);
  });

  it('снятие, отмена одобрена, мероприятие отменено, заявку отклонили — без должности', () => {
    expect(msg.removedText(shift)).toBe(`❌ <b>Вас сняли со смены</b>\n${lines}`);
    expect(msg.cancelApprovedText(shift)).toBe(`👌 <b>Отмену одобрили</b>\n${lines}`);
    expect(msg.eventCancelledText(shift)).toBe(`🚫 <b>Мероприятие отменено</b>\n${lines}`);
    expect(msg.rejectedText({ ...shift, arrive: null, concert: null })).toBe('🙅 <b>Заявку отклонили</b>\n🗓 Сб, 3 октября\n🕕 Начало 20:00');
  });

  it('текст из базы экранируется', () => {
    expect(msg.assignedText({ ...shift, concert: 'Rock & <Roll>', position: '<b>X</b>' }))
      .toBe('✅ <b>Вас поставили на смену</b>\n🗓 Сб, 3 октября\n🕕 Приход 18:00 · начало 20:00\n🎵 Rock &amp; &lt;Roll&gt;\n👤 &lt;b&gt;X&lt;/b&gt;');
    expect(msg.managerSignupText({ name: 'Ян <Ко>', date: '2026-10-03', concert: null }))
      .toBe('📥 <b>Новая заявка</b>\n👤 Ян &lt;Ко&gt;\n🗓 Сб, 3 октября');
  });

  it('новый месяц', () => {
    expect(msg.publishedText({ month: '2026-10', shifts: 6, free: 14 }))
      .toBe('🗓 <b>Опубликованы смены на октябрь</b>\nУ вас 6 смен.\nСвободных мест: 14.');
    expect(msg.publishedText({ month: '2026-10', shifts: 1, free: 0 }))
      .toBe('🗓 <b>Опубликованы смены на октябрь</b>\nУ вас 1 смена.');
  });

  it('свободное место и сводка', () => {
    const place = { date: '2026-10-03', start: '20:00', concert: 'Лунный свет', free: 2 };
    expect(msg.freePlaceText(place))
      .toBe('🙋 <b>Нужен человек</b>\n🗓 Сб, 3 октября\n🕕 Начало 20:00\n🎵 Лунный свет\nСвободно мест: 2');
    expect(msg.freePlacesText([place, { ...place, date: '2026-10-04', concert: null, free: 1 }]))
      .toBe('🙋 <b>Нужны люди</b>\n• Сб, 3 октября, 20:00 — Лунный свет: 2 места\n• Вс, 4 октября, 20:00 — мероприятие: 1 место');
  });

  it('менеджеру: заявка, «не сможет выйти», нехватка', () => {
    const req = { name: 'Полина', date: '2026-10-03', concert: 'Лунный свет' };
    expect(msg.managerSignupText(req)).toBe('📥 <b>Новая заявка</b>\n👤 Полина\n🗓 Сб, 3 октября\n🎵 Лунный свет');
    expect(msg.managerCancelText(req)).toBe('⚠️ <b>Не сможет выйти</b>\n👤 Полина\n🗓 Сб, 3 октября\n🎵 Лунный свет');
    expect(msg.understaffedText([{ date: '2026-10-03', start: '20:00', concert: 'Лунный свет', free: 2 }]))
      .toBe('⚠️ <b>Не хватает людей</b>\n• Сб, 3 октября, 20:00 — Лунный свет: 2 места');
  });

  it('в текстах нет ссылок на приложение', () => {
    for (const t of [msg.assignedText(shift), msg.freePlaceText({ ...shift, free: 1 }), msg.publishedText({ month: '2026-10', shifts: 1, free: 1 })]) {
      expect(t).not.toMatch(/https?:/);
    }
  });
});

describe('напоминания', () => {
  const base = { eventId: 'e1', workerId: 'w1', date: '2026-10-03', start: '20:00', arrive: '18:00', prefs: DEFAULT_WORKER_PREFS };
  it('накануне в 18:00 по Москве — только в течение этого часа', () => {
    expect(dueReminders(new Date('2026-10-02T15:05:00Z'), [base])).toEqual([{ kind: 'reminder_evening', eventId: 'e1', workerId: 'w1' }]);
    expect(dueReminders(new Date('2026-10-02T14:59:00Z'), [base])).toEqual([]);
    expect(dueReminders(new Date('2026-10-02T16:00:00Z'), [base])).toEqual([]);
  });
  it('за 3 часа до прихода — пока приход не наступил', () => {
    expect(dueReminders(new Date('2026-10-03T12:00:00Z'), [base])).toEqual([{ kind: 'reminder_before', eventId: 'e1', workerId: 'w1', hours: 3 }]);
    expect(dueReminders(new Date('2026-10-03T11:59:00Z'), [base])).toEqual([]);
    expect(dueReminders(new Date('2026-10-03T15:00:00Z'), [base])).toEqual([]);
  });
  it('часы в напоминании — сколько осталось на самом деле (округлённо, не меньше 1)', () => {
    const due = (iso: string) => dueReminders(new Date(iso), [base]).find((d) => d.kind === 'reminder_before')?.hours;
    expect(due('2026-10-03T13:10:00Z')).toBe(2); // 1 ч 50 мин
    expect(due('2026-10-03T14:10:00Z')).toBe(1); // 50 мин
    expect(due('2026-10-03T14:50:00Z')).toBe(1); // 10 мин
  });
  it('выключенные напоминания и приход без времени (берётся начало)', () => {
    const off = { ...base, prefs: { ...DEFAULT_WORKER_PREFS, evening: 'off' as const, before: 0 as const } };
    expect(dueReminders(new Date('2026-10-02T15:05:00Z'), [off])).toEqual([]);
    expect(dueReminders(new Date('2026-10-03T14:00:00Z'), [{ ...base, arrive: null }])).toEqual([{ kind: 'reminder_before', eventId: 'e1', workerId: 'w1', hours: 3 }]);
  });
  it('moscowNow', () => {
    expect(moscowNow(new Date('2026-10-02T22:30:00Z'))).toEqual({ date: '2026-10-03', time: '01:30' });
  });
});
