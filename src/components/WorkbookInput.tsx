'use client';

import { useState } from 'react';
import { FileSpreadsheet, Loader2 } from 'lucide-react';
import { FileDropzone } from '@/components/FileDropzone';
import { useRunAction } from '@/components/useRunAction';
import { Button } from '@/components/ui/button';
import { GOOGLE_SOURCES, type GoogleSourceId } from '@/lib/import/googleSources';

/** Один и тот же разбор файла после загрузки с компьютера или получения из заданной таблицы. */
export function WorkbookInput({ source, file, onChange, disabled = false, id, label }: {
  source: GoogleSourceId; file: File | null;
  onChange: (file: File | null, source: GoogleSourceId | null) => void;
  disabled?: boolean; id?: string; label?: string;
}) {
  const [mode, setMode] = useState<'file' | 'google'>('file');
  const [pending, run] = useRunAction();
  const [error, setError] = useState<string | null>(null);
  const blocked = disabled || pending;
  const metadata = GOOGLE_SOURCES[source];

  function switchMode(next: typeof mode) {
    if (next === mode || blocked) return;
    setMode(next);
    setError(null);
    onChange(null, null);
  }

  function load() {
    if (blocked) return;
    setError(null);
    onChange(null, null);
    run(async () => {
      const body = new FormData();
      body.set('source', source);
      const response = await fetch('/api/import/google', { method: 'POST', body });
      if (!response.ok) {
        const data = response.headers.get('content-type')?.includes('application/json')
          ? await response.json() as { error?: string } : null;
        const message = data?.error ?? 'Не удалось прочитать таблицу Google — попробуйте ещё раз';
        setError(message);
        return { error: message };
      }
      const downloaded = new File([await response.blob()], metadata.fileName,
        { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      onChange(downloaded, source);
      return { error: null };
    }, null, undefined, { onError: () => setError(prev => prev ?? 'Не удалось загрузить таблицу — проверьте соединение.') });
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div role="group" aria-label="Откуда взять таблицу" className="flex flex-wrap gap-2">
        {metadata.id && <Button type="button" variant={mode === 'google' ? 'secondary' : 'outline'}
          className="h-11 lg:h-9" aria-pressed={mode === 'google'} disabled={blocked} onClick={() => switchMode('google')}>
          Из Google
        </Button>}
        <Button type="button" variant={mode === 'file' ? 'secondary' : 'outline'}
          className="h-11 lg:h-9" aria-pressed={mode === 'file'} disabled={blocked} onClick={() => switchMode('file')}>
          Из файла
        </Button>
      </div>
      {!metadata.id && <p data-allow-wrap className="text-sm text-muted-foreground">Импорт Google не настроен. Загрузите файл .xlsx.</p>}
      {mode === 'file' ? (
        <FileDropzone id={id} label={label} file={file} disabled={blocked} onChange={next => onChange(next, null)} />
      ) : (
        <div data-contain data-allow-wrap className="flex flex-col items-start gap-3 rounded-lg border bg-card p-4">
          <div>
            <p className="flex items-start gap-2 font-medium"><FileSpreadsheet className="mt-0.5 size-5 shrink-0" aria-hidden="true" />{metadata.name}</p>
            <p className="mt-1 text-sm text-muted-foreground">Получим актуальные данные и покажем сверку. Пока ничего не сохраняется.</p>
          </div>
          <a href={`https://docs.google.com/spreadsheets/d/${metadata.id}/edit`} target="_blank" rel="noopener noreferrer" className="text-sm underline underline-offset-4">Открыть таблицу</a>
          <Button type="button" variant="outline" className="h-11 lg:h-9" onClick={load} disabled={blocked}>
            {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
            {pending ? 'Читаем таблицу…' : file ? 'Обновить сверку' : 'Загрузить таблицу'}
          </Button>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
      )}
    </div>
  );
}
