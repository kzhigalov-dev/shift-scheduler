import { createHash } from 'node:crypto';
import { UserError } from '@/lib/errors';
import { MAX_IMPORT_FILE_BYTES, TOO_LARGE_MESSAGE, type WorkbookSheet } from './workbook';
import { googleSource, type GoogleSourceId } from './googleSources';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const REDIRECT_ERROR = 'Google вернул неподдерживаемое перенаправление — попробуйте загрузить файл .xlsx.';

function safeExportUrl(url: URL): boolean {
  return url.protocol === 'https:' && !url.username && !url.password && !url.port
    && (url.hostname === 'docs.google.com' || /^doc-[a-z0-9-]+-sheets\.googleusercontent\.com$/.test(url.hostname));
}

/** Отпечаток данных: время упаковки и служебные части нового Google-экспорта не имеют значения. */
export function workbookDigest(sheets: WorkbookSheet[]): string {
  return createHash('sha256').update(JSON.stringify(sheets)).digest('hex');
}

/** Публичный экспорт только известных таблиц; содержимое и права Google не изменяются. */
export async function downloadGoogleWorkbook(source: GoogleSourceId): Promise<Buffer> {
  let url = new URL(`https://docs.google.com/spreadsheets/d/${googleSource(source).id}/export?format=xlsx`);
  const signal = AbortSignal.timeout(20_000);
  try {
    for (let redirects = 0; redirects <= 3; redirects++) {
      if (!safeExportUrl(url)) throw new UserError(REDIRECT_ERROR);
      const response = await fetch(url.href, { redirect: 'manual', cache: 'no-store', signal });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        const location = response.headers.get('location');
        if (!location || redirects === 3) throw new UserError(REDIRECT_ERROR);
        url = new URL(location, url);
        continue;
      }
      if (response.status === 401 || response.status === 403) {
        await response.body?.cancel();
        throw new UserError('Нет доступа к таблице Google. Проверьте доступ на просмотр или загрузите файл .xlsx.');
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new UserError('Не удалось получить таблицу Google — попробуйте ещё раз или загрузите файл .xlsx.');
      }
      const contentType = response.headers.get('content-type')?.split(';')[0].trim();
      if (contentType !== XLSX && contentType !== 'application/octet-stream') {
        await response.body?.cancel();
        throw new UserError('Google не вернул файл Excel. Проверьте доступ на просмотр или загрузите файл .xlsx.');
      }
      if (Number(response.headers.get('content-length')) > MAX_IMPORT_FILE_BYTES) {
        await response.body?.cancel();
        throw new UserError(TOO_LARGE_MESSAGE);
      }
      const reader = response.body?.getReader();
      if (!reader) throw new UserError('Google не вернул файл Excel.');
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_IMPORT_FILE_BYTES) throw new UserError(TOO_LARGE_MESSAGE);
          chunks.push(value);
        }
      } finally {
        await reader.cancel();
      }
      const buffer = Buffer.concat(chunks);
      if (buffer.length < 4 || buffer[0] !== 80 || buffer[1] !== 75 || buffer[2] !== 3 || buffer[3] !== 4) {
        throw new UserError('Google не вернул файл Excel.');
      }
      return buffer;
    }
    throw new UserError(REDIRECT_ERROR);
  } catch (error) {
    if (error instanceof UserError) throw error;
    throw new UserError('Не удалось получить таблицу Google — проверьте соединение или загрузите файл .xlsx.');
  }
}
