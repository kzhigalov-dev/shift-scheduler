import { crossSiteResponse, isSameOrigin } from '@/lib/http/sameOrigin';
import { isManager } from '@/lib/auth/session';
import { withManager } from '@/db/client';
import { readInputWorkbook } from '@/lib/import/inputWorkbook';
import { applyGoogleImport, requireImportSnapshot } from '@/lib/import/snapshot';
import type { GoogleSourceId } from '@/lib/import/googleSources';
import { parseSelection, eventsForSelection, importErrorResponse } from '@/lib/import/prepare';
import { applyImport } from '@/lib/import/applyImport';
import { userMessage } from '@/lib/errors';
import type { ParsedEvent } from '@/lib/import/parseSheet';

/**
 * Запись большого импорта (разбор файла и сотни событий в одной транзакции)
 * может занять дольше стандартного лимита функции Vercel. 60 с допустимо на
 * всех тарифах Vercel (максимум Hobby — 300 с с Fluid Compute, 60 с без него).
 */
export const maxDuration = 60;

/** Файл разбирается заново: данным из браузера не доверяем. */
export async function POST(request: Request) {
  if (!(await isManager())) return Response.json({ error: 'Нужен вход менеджера' }, { status: 401 });
  if (!isSameOrigin(request)) return crossSiteResponse();
  const form = await request.formData();
  let events: ParsedEvent[];
  let source: GoogleSourceId | null;
  let snapshot: string | null = null;
  try {
    const selection = parseSelection(JSON.parse(String(form.get('selection') ?? '[]')));
    const input = await readInputWorkbook(form, 'staff', true);
    source = input.source;
    const sheets = input.sheets;
    if (source) snapshot = requireImportSnapshot(form.get('snapshot'));
    events = eventsForSelection(sheets, selection);
  } catch (error) {
    return Response.json({ error: userMessage(error, 'Не удалось разобрать файл') }, { status: 400 });
  }

  try {
    const summary = await withManager((tx) => source && snapshot
      ? applyGoogleImport(tx, events, snapshot, form.get('replacePositions') === '1', form.get('allowPotentialMoves') === '1')
      : applyImport(tx, events));
    return Response.json({ summary });
  } catch (error) {
    const { status, body } = importErrorResponse(error);
    return Response.json(body, { status });
  }
}
