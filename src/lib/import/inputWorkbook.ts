import { UserError } from '@/lib/errors';
import { downloadGoogleWorkbook, workbookDigest } from './googleDownload';
import { googleSource, type GoogleSourceId } from './googleSources';
import { readWorkbook, MAX_IMPORT_FILE_BYTES, TOO_LARGE_MESSAGE } from './workbook';

/** Применение Google проверяет актуальные значения; обычный файл остаётся самостоятельным источником. */
export async function readInputWorkbook(form: FormData, allowed: GoogleSourceId, verifyGoogle = false) {
  const file = form.get('file');
  if (!(file instanceof File)) throw new UserError('Файл не выбран');
  if (file.size > MAX_IMPORT_FILE_BYTES) throw new UserError(TOO_LARGE_MESSAGE);
  const rawSource = form.get('source');
  if (rawSource !== null && rawSource !== allowed) throw new UserError('Выбран неподходящий источник Google.');
  const source = rawSource === allowed ? allowed : null;
  if (source) googleSource(source);
  const sheets = await readWorkbook(Buffer.from(await file.arrayBuffer()));
  if (source && verifyGoogle) {
    const latest = await readWorkbook(await downloadGoogleWorkbook(source));
    if (workbookDigest(sheets) !== workbookDigest(latest)) {
      throw new UserError('Таблица Google изменилась — обновите сверку и повторите загрузку.');
    }
  }
  return { sheets, source };
}
