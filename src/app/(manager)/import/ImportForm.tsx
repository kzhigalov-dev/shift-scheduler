'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Check, ChevronDown, Loader2 } from 'lucide-react';
import type { SheetPreview, SheetSelection } from '@/lib/import/prepare';
import { useRunAction } from '@/components/useRunAction';
import type { PotentialMove, PositionConflict } from '@/lib/import/snapshot';
import type { ImportSummary } from '@/lib/import/applyImport';
import { formatDate } from '@/lib/format';
import { monthTitle } from '@/lib/month';
import { cn } from '@/lib/utils';
import { WorkbookInput } from '@/components/WorkbookInput';
import type { GoogleSourceId } from '@/lib/import/googleSources';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

type PreviewResponse = { sheets: SheetPreview[]; dbSnapshot: string | null; positionConflicts: PositionConflict[]; moves: PotentialMove[]; eventCounts: Record<string,number> } | { error: string; scheduleMonths?: string[] };
type ApplyResponse = { summary: ImportSummary } | { error: string };

type RowState = { checked: boolean; year: number | null };

const currentYear = new Date().getFullYear();
const YEAR_OPTIONS = Array.from(
  { length: currentYear - 2022 + 1 },
  (_, i) => 2022 + i,
);

const STEPS = ['Файл', 'Сверка', 'Готово'] as const;
const STEP_TITLES = ['Выбор файла', 'Сверка листов', 'Импорт завершён'] as const;

const MONTH_NUMBERS: Record<string, number> = {
  январь: 1, февраль: 2, март: 3, апрель: 4, май: 5, июнь: 6,
  июль: 7, август: 8, сентябрь: 9, октябрь: 10, ноябрь: 11, декабрь: 12,
};

/** Месяц `YYYY-MM` листа: по дате первого события, иначе — из названия листа и выбранного года. */
function sheetMonthParam(sheet: SheetPreview | undefined, year: number | null): string | null {
  if (!sheet) return null;
  const date = sheet.events[0]?.date;
  if (date) return date.slice(0, 7);
  const word = sheet.sheetName.trim().toLowerCase().split(/\s+/)[0] ?? '';
  const month = Object.hasOwn(MONTH_NUMBERS, word) ? MONTH_NUMBERS[word] : null;
  return month !== null && year !== null ? `${year}-${String(month).padStart(2, '0')}` : null;
}

/** Шкала шагов: пройденные и текущий — основным цветом, впереди — приглушённо. */
function Steps({ current }: { current: 1 | 2 | 3 }) {
  return (
    <ol aria-label="Шаги импорта" className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
      {STEPS.map((label, i) => {
        const n = i + 1;
        const done = n < current;
        const active = n === current;
        return (
          <li
            key={label}
            aria-current={active ? 'step' : undefined}
            className={cn(
              'flex items-center gap-2 whitespace-nowrap',
              active ? 'font-medium text-foreground' : 'text-muted-foreground',
            )}
          >
            <span
              className={cn(
                'flex size-6 shrink-0 items-center justify-center rounded-full border text-xs tabular-nums',
                active && 'border-primary bg-primary text-primary-foreground',
                done && 'border-transparent bg-muted text-foreground',
              )}
            >
              {done ? <Check className="size-3.5" aria-hidden="true" /> : n}
            </span>
            {label}
            {n < STEPS.length && <span aria-hidden="true" className="ml-1 text-muted-foreground">→</span>}
          </li>
        );
      })}
    </ol>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card data-contain>
      <CardContent className="flex flex-col gap-1">
        <p className="text-muted-foreground">{label}</p>
        <p className="text-[28px] leading-9 font-semibold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
}

export function ImportForm() {
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState<GoogleSourceId | null>(null);
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [replacePositions, setReplacePositions] = useState(false);
  const [positionConflicts, setPositionConflicts] = useState<PositionConflict[]>([]);
  const [moves, setMoves] = useState<PotentialMove[]>([]);
  const [eventCounts, setEventCounts] = useState<Record<string,number>>({});
  const [allowPotentialMoves, setAllowPotentialMoves] = useState(false);
  const [reviewedSelection, setReviewedSelection] = useState<string | null>(null);
  const [reviewPending, runReview] = useRunAction();
  const [sheets, setSheets] = useState<SheetPreview[] | null>(null);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [openIssues, setOpenIssues] = useState<Record<string, boolean>>({});
  const [previewError, setPreviewError] = useState<string | null>(null);
  /** Загружен файл расписания: месяцы, которые из него можно создать в «Новом месяце». */
  const [scheduleMonths, setScheduleMonths] = useState<string[]>([]);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [applyLoading, setApplyLoading] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const selection = useMemo<SheetSelection[]>(
    () => Object.entries(rows)
      .filter(([, row]) => row.checked)
      .map(([name, row]) => (row.year === null ? { name } : { name, year: row.year })),
    [rows],
  );

  /** Новый файл — сверка заново; null (файл убран) — шаг 1, как будто файла не было. */
  async function handleFileChange(chosen: File | null, origin: GoogleSourceId | null = null) {
    setSource(origin);
    setSnapshot(null);
    setReplacePositions(false);
    setPositionConflicts([]);
    setMoves([]);
    setEventCounts({});
    setReviewedSelection(null);
    setAllowPotentialMoves(false);
    setFile(chosen);
    setSheets(null);
    setRows({});
    setOpenIssues({});
    setPreviewError(null);
    setScheduleMonths([]);
    setApplyError(null);
    setSummary(null);
    if (!chosen) return;

    setPreviewLoading(true);
    try {
      const formData = new FormData();
      formData.set('file', chosen);
      if (origin) formData.set('source', origin);
      const res = await fetch('/api/import/preview', { method: 'POST', body: formData });
      const data = (await res.json()) as PreviewResponse;
      if ('error' in data) {
        setPreviewError(data.error);
        setScheduleMonths(data.scheduleMonths ?? []);
        return;
      }
      setSheets(data.sheets);
      setSnapshot(data.dbSnapshot);
      setPositionConflicts(data.positionConflicts);
      setMoves(data.moves);
      setEventCounts(data.eventCounts);
      const initial: Record<string, RowState> = {};
      for (const sheet of data.sheets) {
        initial[sheet.sheetName] = { checked: !origin && !sheet.needsYear && sheet.events.length > 0, year: null };
      }
      setRows(initial);
    } catch {
      setPreviewError('Не удалось отправить файл на проверку');
    } finally {
      setPreviewLoading(false);
    }
  }

  function setRow(name: string, patch: Partial<RowState>) {
    setRows((prev) => ({ ...prev, [name]: { ...prev[name], ...patch } }));
  }

  /** Первый выбор года включает лист; смена года отметку сохраняет. */
  function setYear(name: string, year: number) {
    setRows((prev) => {
      const current = prev[name] ?? { checked: false, year: null };
      return { ...prev, [name]: { year, checked: current.year === null ? true : current.checked } };
    });
  }

  /** Возврат на шаг «Файл»: выбор и результат сверки сбрасываются. */
  function handleBack() {
    setFile(null);
    setSheets(null);
    setRows({});
    setOpenIssues({});
    setPreviewError(null);
    setScheduleMonths([]);
    setApplyError(null);
    setSummary(null);
  }

  async function handleImport() {
    if (!file) return;
    setApplyLoading(true);
    setApplyError(null);
    setSummary(null);
    try {
      const formData = new FormData();
      formData.set('file', file);
      if (source) {
        formData.set('source', source);
        formData.set('snapshot', snapshot ?? '');
        if (replacePositions) formData.set('replacePositions', '1');
        if (allowPotentialMoves) formData.set('allowPotentialMoves', '1');
      }
      formData.set('selection', JSON.stringify(selection));
      const res = await fetch('/api/import/apply', { method: 'POST', body: formData });
      const data = (await res.json()) as ApplyResponse;
      if ('error' in data) {
        setApplyError(data.error);
        return;
      }
      setSummary(data.summary);
    } catch {
      setApplyError('Не удалось отправить запрос на импорт');
    } finally {
      setApplyLoading(false);
    }
  }

  const selectionKey = JSON.stringify(selection);
  const reviewCurrent = !source || reviewedSelection === selectionKey;

  function handleReview() {
    if (!file || !source || selection.length === 0) return;
    const selected = selectionKey;
    setApplyError(null); setReviewedSelection(null); setAllowPotentialMoves(false); setReplacePositions(false);
    runReview(async () => {
      const body = new FormData(); body.set('file',file); body.set('source',source); body.set('selection',selected);
      const response = await fetch('/api/import/preview',{method:'POST',body});
      const data = await response.json() as PreviewResponse;
      if ('error' in data) {setApplyError(data.error);return {error:data.error};}
      setSnapshot(data.dbSnapshot); setPositionConflicts(data.positionConflicts); setMoves(data.moves); setEventCounts(data.eventCounts);
      setReviewedSelection(selected);
      return {error:null};
    },null,undefined,{onError:()=>setApplyError(prev=>prev ?? 'Не удалось проверить выбранные листы — попробуйте ещё раз.')});
  }

  const canImport = file !== null && selection.length > 0 && !applyLoading
    && !previewLoading && !reviewPending && reviewCurrent && (moves.length === 0 || allowPotentialMoves)
    && selection.every((s) => {
      const sheet = sheets?.find((sh) => sh.sheetName === s.name);
      return !sheet?.needsYear || s.year !== undefined;
    });

  const hasSheets = sheets !== null && sheets.length > 0;
  const step: 1 | 2 | 3 = summary ? 3 : hasSheets ? 2 : 1;

  // Месяц первого выбранного листа — куда ведёт «Открыть месяц»; пока он не определён, ссылки нет.
  const openedMonth = useMemo(() => {
    for (const s of selection) {
      const month = sheetMonthParam(sheets?.find((sh) => sh.sheetName === s.name), s.year ?? null);
      if (month) return month;
    }
    return null;
  }, [selection, sheets]);

  // При смене шага фокус переходит на заголовок нового шага (при первом показе фокус не трогаем).
  const shownStep = useRef(step);
  useEffect(() => {
    if (shownStep.current === step) return;
    shownStep.current = step;
    headingRef.current?.focus();
  }, [step]);

  const resultText = summary
    ? `Импорт завершён. Событий создано: ${summary.eventsCreated}, обновлено: ${summary.eventsUpdated}. `
      + `Новых работников: ${summary.workersCreated}. Назначений: ${summary.assignmentsCreated}.`
    : '';

  return (
    <div>
      <Steps current={step} />
      <h2 ref={headingRef} tabIndex={-1} className="sr-only outline-none">{STEP_TITLES[step - 1]}</h2>
      <p role="status" className="sr-only">{resultText}</p>

      {step === 1 && (
        <div className="flex flex-col gap-3">
          <WorkbookInput source="staff" id="file" file={file} onChange={handleFileChange} disabled={previewLoading} />
          {previewLoading ? (
            <p className="flex items-center gap-2 text-muted-foreground" role="status">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />Читаем файл…
            </p>
          ) : (
            <p className="text-muted-foreground">.xlsx, до 4 МБ</p>
          )}
          {previewError && scheduleMonths.length > 0 ? (
            <div className="flex flex-col items-start gap-3 rounded-lg bg-status-warning-bg p-3 text-status-warning-fg" role="alert">
              <p>{previewError}</p>
              <div className="flex flex-wrap gap-2">
                {scheduleMonths.map((m) => (
                  <Button key={m} asChild size="sm" variant="outline">
                    <Link href={`/month/new?month=${m}`}>В «Новый месяц»: {monthTitle(m).toLowerCase()}</Link>
                  </Button>
                ))}
              </div>
            </div>
          ) : previewError && (
            <p className="text-destructive" role="alert">{previewError}</p>
          )}
          {sheets && sheets.length === 0 && (
            <p className="text-muted-foreground">В файле нет листов месяцев.</p>
          )}
        </div>
      )}

      {step === 2 && sheets && (
        <div className="flex flex-col gap-4">
          {source && (
            <div data-contain data-allow-wrap className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-4">
              <p className="text-sm text-muted-foreground">Выберите нужные листы. Уже назначенные люди, ручные ставки, приход и программы концертов сохранятся.</p>
              <Button type="button" variant="outline" className="h-11 w-fit lg:h-9" onClick={handleReview} disabled={reviewPending || applyLoading || selection.length === 0}>
                {reviewPending ? 'Сверяем…' : 'Проверить выбранные листы'}
              </Button>
              {!reviewCurrent && selection.length > 0 && <p className="text-sm text-muted-foreground">Проверьте выбранные листы перед сохранением.</p>}
              {reviewCurrent && moves.length > 0 && <div className="flex flex-col gap-3">
                <p className="text-sm font-medium">Возможные переносы</p>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  {moves.map((move,i)=><li key={i}>{move.title}: в таблице {formatDate(move.date)} · {move.startTime}; в календаре {move.candidates.map(candidate=>`${formatDate(candidate.date)} · ${candidate.startTime}`).join(', ')}.</li>)}
                </ul>
                <label className="flex items-start gap-3 text-sm">
                  <Checkbox checked={allowPotentialMoves} disabled={!reviewCurrent || reviewPending || applyLoading} onCheckedChange={value=>setAllowPotentialMoves(value===true)} aria-label="Создать возможные переносы как новые мероприятия" />
                  <span>Создать эти строки как новые мероприятия. Прежние останутся в календаре.</span>
                </label>
              </div>}
              {reviewCurrent && positionConflicts.length > 0 && <details>
                <summary className="cursor-pointer text-sm font-medium">Различаются должности · {positionConflicts.length}</summary>
                <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                  {positionConflicts.map((conflict, i) => <li key={i}>{formatDate(conflict.date)} · {conflict.startTime} · {conflict.name}: {conflict.current ?? 'Без должности'} → {conflict.incoming}</li>)}
                </ul>
              </details>}
              <label className="flex items-start gap-3 text-sm">
                <Checkbox checked={replacePositions} disabled={!reviewCurrent || reviewPending || applyLoading} onCheckedChange={value => setReplacePositions(value === true)} aria-label="Заменить ранее назначенные должности" />
                <span>Заменить ранее назначенные должности данными таблицы</span>
              </label>
            </div>
          )}
          <div data-layout-scroll className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-10"><span className="sr-only">Выбор</span></TableHead>
                  <TableHead>Лист</TableHead>
                  <TableHead className="text-right">Событий</TableHead>
                  <TableHead>Замечания</TableHead>
                  <TableHead className="hidden md:table-cell">Год</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sheets.map((sheet, index) => {
                  const row = rows[sheet.sheetName] ?? { checked: false, year: null };
                  const disabled = sheet.needsYear && row.year === null;
                  const issuesOpen = openIssues[sheet.sheetName] === true;
                  const yearSelect = sheet.needsYear ? (
                      <Select
                        value={row.year === null ? '' : String(row.year)}
                        onValueChange={(value) => setYear(sheet.sheetName, Number(value))}
                      >
                        <SelectTrigger
                          aria-label={`Год для листа ${sheet.sheetName}`}
                          className="w-32 data-[size=default]:h-11 lg:data-[size=default]:h-9"
                        >
                          <SelectValue placeholder="Выберите" />
                        </SelectTrigger>
                        <SelectContent>
                          {YEAR_OPTIONS.map((y) => (
                            <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                  ) : null;
                  const issuesId = `import-issues-${index}`;
                  return (
                    <Fragment key={sheet.sheetName}>
                      <TableRow>
                        <TableCell>
                          <Checkbox
                            checked={row.checked}
                            disabled={disabled}
                            aria-label={`Импортировать лист ${sheet.sheetName}`}
                            onCheckedChange={(value) => setRow(sheet.sheetName, { checked: value === true })}
                          />
                        </TableCell>
                        <TableCell>
                          <div className="max-w-32 truncate md:max-w-56" title={sheet.sheetName}>{sheet.sheetName}</div>
                          {yearSelect && <div className="mt-2 md:hidden">{yearSelect}</div>}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{eventCounts[sheet.sheetName] ?? sheet.events.length}</TableCell>
                        <TableCell>
                          {sheet.issues.length > 0 ? (
                            <button
                              type="button"
                              aria-expanded={issuesOpen}
                              aria-controls={issuesOpen ? issuesId : undefined}
                              aria-label={`Замечания: ${sheet.issues.length}`}
                              onClick={() => setOpenIssues((prev) => ({ ...prev, [sheet.sheetName]: !issuesOpen }))}
                              className="-mx-1 inline-flex h-11 items-center gap-1 rounded-md px-1 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 lg:h-9"
                            >
                              <StatusBadge tone="warning">{sheet.issues.length}</StatusBadge>
                              <ChevronDown
                                className={cn('size-4 text-muted-foreground transition-transform', issuesOpen && 'rotate-180')}
                                aria-hidden="true"
                              />
                            </button>
                          ) : (
                            <span className="text-muted-foreground tabular-nums">0</span>
                          )}
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          {yearSelect}
                        </TableCell>
                      </TableRow>
                      {issuesOpen && (
                        <TableRow id={issuesId} className="bg-muted/40 hover:bg-muted/40">
                          <TableCell />
                          <TableCell colSpan={4} className="whitespace-normal py-3">
                            <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
                              {sheet.issues.map((issue, i) => (
                                <li key={i}>{issue.message}</li>
                              ))}
                            </ul>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button type="button" variant="outline" className="h-11 lg:h-9" onClick={handleBack} disabled={applyLoading}>
              Назад
            </Button>
            <div className="flex flex-wrap items-center justify-end gap-3">
              {!canImport && !applyLoading && (
                <p id="import-hint" className="text-muted-foreground">{selection.length === 0 ? 'Отметьте хотя бы один лист.' : !reviewCurrent ? 'Проверьте выбранные листы.' : moves.length > 0 && !allowPotentialMoves ? 'Решите, как поступить с возможными переносами.' : 'Выберите год.'}</p>
              )}
              <Button
                type="button"
                className="h-11 lg:h-9"
                onClick={handleImport}
                disabled={!canImport}
                aria-describedby={!canImport && !applyLoading ? 'import-hint' : undefined}
              >
                {applyLoading && <Loader2 className="animate-spin" aria-hidden="true" />}
                {applyLoading ? 'Импортируем…' : 'Импортировать'}
              </Button>
            </div>
          </div>
          {applyError && (
            <p className="text-destructive" role="alert">{applyError}</p>
          )}
        </div>
      )}

      {step === 3 && summary && (
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Событий создано" value={summary.eventsCreated} />
            <StatCard label="Событий обновлено" value={summary.eventsUpdated} />
            <StatCard label="Новых работников" value={summary.workersCreated} />
            <StatCard label="Назначений" value={summary.assignmentsCreated} />
          </div>

          {summary.conflicts.length > 0 && (
            <Card data-contain>
              <CardContent className="flex flex-col gap-3">
                <div>
                  <h3 className="text-lg font-medium">Конфликты должностей</h3>
                  <p className="text-muted-foreground">Оставлена более поздняя запись.</p>
                </div>
                <ul className="flex flex-col divide-y">
                  {summary.conflicts.map((c, i) => (
                    <li key={i} className="flex flex-col gap-0.5 py-2 first:pt-0 last:pb-0">
                      <span className="break-words font-medium">
                        {formatDate(c.date)} · <span className="tabular-nums">{c.startTime}</span> · {c.name}
                      </span>
                      <span className="break-words text-muted-foreground">
                        Оставлено: {c.kept}. Было: {c.dropped}.
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          <div className="flex flex-wrap items-center gap-3">
            {openedMonth && (
              <Button asChild className="h-11 lg:h-9">
                <Link href={`/month?month=${openedMonth}`}>Открыть месяц</Link>
              </Button>
            )}
            <Button type="button" variant="outline" className="h-11 lg:h-9" onClick={handleBack}>
              Загрузить другой файл
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
