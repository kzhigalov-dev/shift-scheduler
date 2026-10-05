import { UserError } from '@/lib/errors';

/** Только эти источники: браузер не может заставить сервер скачать произвольный адрес. */
export const GOOGLE_SOURCES = {
  staff: { id: process.env.NEXT_PUBLIC_GOOGLE_STAFF_SHEET_ID ?? '', name: 'Работники и смены', fileName: 'Работники и смены.xlsx' },
  schedule: { id: process.env.NEXT_PUBLIC_GOOGLE_SCHEDULE_SHEET_ID ?? '', name: 'Расписание мероприятий', fileName: 'Расписание мероприятий.xlsx' },
  concerts: { id: process.env.NEXT_PUBLIC_GOOGLE_CONCERTS_SHEET_ID ?? '', name: 'Орган и не только', fileName: 'Орган и не только.xlsx' },
} as const;

export type GoogleSourceId = keyof typeof GOOGLE_SOURCES;

export function googleSource(value: string) {
  if (!Object.hasOwn(GOOGLE_SOURCES, value)) throw new UserError('Неизвестный источник Google');
  const source = GOOGLE_SOURCES[value as GoogleSourceId];
  if (!source.id) throw new UserError('Таблица Google не настроена — используйте импорт из файла.');
  if (!/^[A-Za-z0-9_-]+$/.test(source.id)) throw new UserError('Неверный идентификатор таблицы Google.');
  return source;
}

export function googleSourceUrl(source: GoogleSourceId): string {
  return `https://docs.google.com/spreadsheets/d/${googleSource(source).id}/edit`;
}
