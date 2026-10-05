import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadGoogleWorkbook, workbookDigest } from '@/lib/import/googleDownload';
import { googleSource } from '@/lib/import/googleSources';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const bytes = new Uint8Array([80, 75, 3, 4, 1, 2, 3]);
const excel = () => new Response(bytes, { headers: { 'content-type': XLSX } });
afterEach(() => vi.restoreAllMocks());

describe('получение фиксированных таблиц Google', () => {
  it('не принимает произвольные адреса и идентификаторы', () => {
    expect(() => googleSource('https://localhost/private')).toThrow();
    expect(() => googleSource('constructor')).toThrow();
    expect(googleSource('schedule').id).toBe('demo_schedule_sheet');
  });
  it('получает Excel актуального расписания без записи в таблицу', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      expect(String(input)).toBe('https://docs.google.com/spreadsheets/d/demo_schedule_sheet/export?format=xlsx');
      expect(init?.method ?? 'GET').toBe('GET');
      expect(init?.redirect).toBe('manual');
      expect(init?.cache).toBe('no-store');
      return excel();
    });
    expect(await downloadGoogleWorkbook('schedule')).toEqual(Buffer.from(bytes));
  });
  it('принимает перенаправление на проверенный сервер экспорта Google', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, {
      status: 302, headers: { location: 'https://doc-0o-50-sheets.googleusercontent.com/export/xlsx' },
    })).mockResolvedValueOnce(excel());
    expect(await downloadGoogleWorkbook('staff')).toEqual(Buffer.from(bytes));
  });
  it.each([
    'https://localhost/private', 'http://doc-0o-50-sheets.googleusercontent.com/export',
    'https://doc-0o-50-sheets.googleusercontent.com.evil.test/export',
    'https://evil.googleusercontent.com/export',
    'https://doc-0o-50-sheets.googleusercontent.com:8443/export',
    'https://user:pass@doc-0o-50-sheets.googleusercontent.com/export',
  ])('не выполняет запрос по опасному перенаправлению %s', async (location) => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (!String(input).startsWith('https://docs.google.com/spreadsheets/d/')) {
        throw new Error('Небезопасный сетевой запрос уже отправлен');
      }
      return new Response(null, { status: 302, headers: { location } });
    });
    await expect(downloadGoogleWorkbook('concerts')).rejects.toThrow('перенаправ');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([401, 403])('показывает понятную ошибку доступа (%s)', async status => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('private account details', { status }));
    await expect(downloadGoogleWorkbook('schedule')).rejects.toThrow('доступ');
  });
  it('не выдаёт страницу входа за Excel', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<html>login</html>', {
      headers: { 'content-type': 'text/html' },
    }));
    await expect(downloadGoogleWorkbook('staff')).rejects.toThrow('Excel');
  });
  it('проверяет сигнатуру файла, а не только Content-Type', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('not a workbook', {
      headers: { 'content-type': XLSX },
    }));
    await expect(downloadGoogleWorkbook('staff')).rejects.toThrow('Excel');
  });
  it('останавливает поток, превысивший 4 МБ, даже без Content-Length', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(4 * 1024 * 1024 + 1)); controller.close(); },
    }), { headers: { 'content-type': XLSX } }));
    await expect(downloadGoogleWorkbook('staff')).rejects.toThrow('4 МБ');
  });
  it('обрывает цикл перенаправлений', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, {
      status: 302, headers: { location: 'https://docs.google.com/spreadsheets/d/loop/export' },
    }));
    await expect(downloadGoogleWorkbook('staff')).rejects.toThrow('перенаправ');
  });
  it('скрывает детали сетевой ошибки', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('secret upstream credential'));
    await expect(downloadGoogleWorkbook('staff')).rejects.toThrow('Не удалось');
    await expect(downloadGoogleWorkbook('staff')).rejects.not.toThrow('secret');
  });
});

describe('отпечаток содержимого, а не архива Excel', () => {
  it('совпадает для одинаковых значений и меняется после правки ячейки', () => {
    const sheets = [{ name: '2026', rows: [[new Date('2026-10-06T00:00:00Z'), 'Концерт']] }];
    const digest = workbookDigest(sheets);
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(workbookDigest([{ name: '2026', rows: [[new Date('2026-10-06T00:00:00Z'), 'Концерт']] }])).toBe(digest);
    expect(workbookDigest([{ name: '2026', rows: [[new Date('2026-10-06T00:00:00Z'), 'Новое название']] }])).not.toBe(digest);
  });
});

import ExcelJS from 'exceljs';
import { readInputWorkbook } from '@/lib/import/inputWorkbook';

async function book(title: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('2026').addRow(['дата','название',title]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('повторная проверка Google перед применением', () => {
  it('отклоняет загрузку, когда Google изменился после сверки', async () => {
    const original = await book('Прежнее');
    const current = await book('Новое');
    const form = new FormData();
    form.set('file',new File([new Uint8Array(original)],'test.xlsx'));
    form.set('source','staff');
    vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(new Uint8Array(current),{headers:{'content-type':XLSX}}));
    await expect(readInputWorkbook(form,'staff',true)).rejects.toThrow('сверку');
  });
  it('не требует Google для обычного файлового импорта', async () => {
    const form = new FormData();
    form.set('file',new File([new Uint8Array(await book('Прежнее'))],'test.xlsx'));
    vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('Google не должен вызываться'));
    expect((await readInputWorkbook(form,'staff',true)).source).toBeNull();
  });
  it('не разрешает подменить назначение источника', async () => {
    const form = new FormData();
    form.set('file',new File([new Uint8Array(await book('Прежнее'))],'test.xlsx'));
    form.set('source','concerts');
    await expect(readInputWorkbook(form,'staff',true)).rejects.toThrow('источник');
  });
});
