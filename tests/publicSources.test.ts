import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

it('без настройки таблиц нет ссылки на рабочий источник и сетевого запроса', async () => {
  vi.stubEnv('NEXT_PUBLIC_GOOGLE_STAFF_SHEET_ID', '');
  vi.resetModules();
  const { googleSource } = await import('@/lib/import/googleSources');
  expect(() => googleSource('staff')).toThrow('не настроена');
});

it('источник берётся из настройки, произвольный адрес не допускается', async () => {
  vi.stubEnv('NEXT_PUBLIC_GOOGLE_STAFF_SHEET_ID', 'https://localhost/private');
  vi.resetModules();
  const { googleSource } = await import('@/lib/import/googleSources');
  expect(() => googleSource('staff')).toThrow('идентификатор');
});

it('принимает собственный идентификатор таблицы', async () => {
  vi.stubEnv('NEXT_PUBLIC_GOOGLE_STAFF_SHEET_ID', 'demo_staff_sheet');
  vi.resetModules();
  const { googleSource, googleSourceUrl } = await import('@/lib/import/googleSources');
  expect(googleSource('staff').id).toBe('demo_staff_sheet');
  expect(googleSourceUrl('staff')).toBe('https://docs.google.com/spreadsheets/d/demo_staff_sheet/edit');
});
