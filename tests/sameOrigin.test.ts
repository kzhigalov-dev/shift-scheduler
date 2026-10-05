import { describe, it, expect, vi } from 'vitest';
import { isSameOrigin } from '@/lib/http/sameOrigin';

/** L1 полного ревью безопасности: POST-маршруты принимают запрос только со страниц приложения. */
const post = (headers: Record<string, string>, url = 'https://annenshifts.example/api/import/preview') =>
  new Request(url, { method: 'POST', headers });

describe('isSameOrigin', () => {
  it('Origin совпадает с хостом запроса — да', () => {
    expect(isSameOrigin(post({ host: 'annenshifts.example', origin: 'https://annenshifts.example' }))).toBe(true);
    expect(isSameOrigin(post({ host: 'localhost:3100', origin: 'http://localhost:3100' }, 'http://localhost:3100/api/x'))).toBe(true);
  });

  it('за прокси (Vercel) хост — из x-forwarded-host', () => {
    expect(isSameOrigin(post({
      host: 'internal', 'x-forwarded-host': 'annenshifts.example', origin: 'https://annenshifts.example',
    }))).toBe(true);
  });

  it('чужой Origin, null и мусор — нет', () => {
    expect(isSameOrigin(post({ host: 'annenshifts.example', origin: 'https://evil.example' }))).toBe(false);
    expect(isSameOrigin(post({ host: 'annenshifts.example', origin: 'https://sub.annenshifts.example' }))).toBe(false);
    expect(isSameOrigin(post({ host: 'annenshifts.example', origin: 'null' }))).toBe(false);
    expect(isSameOrigin(post({ host: 'annenshifts.example', origin: 'annenshifts.example' }))).toBe(false);
  });

  it('без Origin решает Referer', () => {
    expect(isSameOrigin(post({ host: 'annenshifts.example', referer: 'https://annenshifts.example/import' }))).toBe(true);
    expect(isSameOrigin(post({ host: 'annenshifts.example', referer: 'https://evil.example/annenshifts.example' }))).toBe(false);
  });

  it('ни Origin, ни Referer — нет (браузер шлёт Origin с каждым POST)', () => {
    expect(isSameOrigin(post({ host: 'annenshifts.example' }))).toBe(false);
  });

  it('Origin важнее Referer', () => {
    expect(isSameOrigin(post({
      host: 'annenshifts.example', origin: 'https://evil.example', referer: 'https://annenshifts.example/import',
    }))).toBe(false);
  });
});

vi.mock('@/lib/auth/session', () => ({ isManager: async () => true }));
const readWorkbook = vi.fn(async () => { throw new Error('файл не должен читаться'); });
vi.mock('@/lib/import/workbook', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/import/workbook')>()),
  readWorkbook: () => readWorkbook(),
}));
vi.mock('@/db/client', () => ({ withManager: async () => { throw new Error('база не должна вызываться'); } }));

describe('POST-маршруты менеджера отвергают чужой Origin (403) до разбора файла', () => {
  const routes = [
    '@/app/api/import/preview/route', '@/app/api/import/apply/route',
    '@/app/api/schedule/preview/route', '@/app/api/schedule/apply/route',
  ];
  it.each(routes)('%s', async (route) => {
    const { POST } = await import(route) as { POST: (r: Request) => Promise<Response> };
    const body = new FormData();
    body.set('month', '2099-07');
    body.set('file', new File([new Uint8Array([1, 2, 3])], 'x.xlsx'));
    const res = await POST(new Request('https://annenshifts.example/api/x', {
      method: 'POST', body, headers: { host: 'annenshifts.example', origin: 'https://evil.example' },
    }));
    expect(res.status).toBe(403);
    expect(readWorkbook).not.toHaveBeenCalled();
  });
});
