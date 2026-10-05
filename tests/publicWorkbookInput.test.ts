import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
it('при отсутствии Google-настройки оставляет файловый импорт и понятную подсказку', async () => {
  vi.stubEnv('NEXT_PUBLIC_GOOGLE_STAFF_SHEET_ID', '');
  vi.resetModules();
  const { WorkbookInput } = await import('@/components/WorkbookInput');
  const html = renderToStaticMarkup(createElement(WorkbookInput, { source: 'staff', file: null, onChange: () => {} }));
  expect(html).toContain('Импорт Google не настроен');
  expect(html).toContain('type="file"');
  expect(html).not.toContain('Из Google');
});
