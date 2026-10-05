'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { FileSpreadsheet, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button, buttonVariants } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { formatFileSize } from '@/lib/format';
import { cn } from '@/lib/utils';

const isXlsx = (file: File) => file.name.toLowerCase().endsWith('.xlsx');
const hasFiles = (e: DragEvent | React.DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');

/**
 * Выбор файла .xlsx: перетаскивание или кнопка. Выбранный файл — плашка с именем, размером и «Убрать файл»;
 * на плашку тоже можно бросить файл — он заменит выбранный.
 * Настоящее `<input type="file">` остаётся в DOM (sr-only): через него работает выбор и `setInputFiles` в проверке вёрстки.
 * `id` ставится на зону — к ней ведёт `<Label htmlFor>`.
 */
export function FileDropzone({ file, onChange, disabled = false, id, label }: {
  file: File | null; onChange: (file: File | null) => void; disabled?: boolean; id?: string; label?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const zoneRef = useRef<HTMLButtonElement>(null);
  const removeRef = useRef<HTMLButtonElement>(null);
  /** Куда перевести фокус, когда зона и плашка поменяются местами по действию внутри компонента. */
  const focusNext = useRef<'remove' | 'zone' | null>(null);
  /** Глубина dragenter/dragleave: переходы между потомками не гасят подсветку. */
  const depth = useRef(0);
  const [over, setOver] = useState(false);
  const ownId = useId();
  const zoneId = id ?? ownId;

  // Файл, брошенный мимо зоны, браузер открыл бы вместо страницы; курсор там — «нельзя».
  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      if (!hasFiles(e) || e.defaultPrevented) return; // зона уже ответила сама
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
    };
    const onDrop = (e: DragEvent) => { if (hasFiles(e)) e.preventDefault(); };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  // Зона и плашка меняются местами — фокус не должен падать на <body>. Только после действий здесь,
  // не при первом показе и не при смене файла снаружи.
  useEffect(() => {
    const target = focusNext.current;
    focusNext.current = null;
    if (target === 'remove' && file) removeRef.current?.focus();
    if (target === 'zone' && !file) zoneRef.current?.focus();
  }, [file]);

  function choose(next: File | undefined) {
    // Сбрасываем поле: повторный выбор того же файла снова вызовет onChange.
    if (inputRef.current) inputRef.current.value = '';
    if (!next) return;
    if (!isXlsx(next)) { toast.error('Нужен файл .xlsx'); return; }
    focusNext.current = 'remove';
    onChange(next);
  }

  function clear() {
    if (disabled) return;
    if (inputRef.current) inputRef.current.value = '';
    focusNext.current = 'zone';
    onChange(null);
  }

  /** Приём перетаскивания — общий у зоны и плашки. Пока `disabled`, не отвечаем: курсор «нельзя» ставит window. */
  const dropTarget = {
    onDragEnter: (e: React.DragEvent) => {
      if (disabled || !hasFiles(e)) return;
      e.preventDefault();
      depth.current += 1;
      setOver(true);
    },
    onDragOver: (e: React.DragEvent) => {
      if (disabled || !hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    },
    onDragLeave: () => {
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setOver(false);
    },
    onDrop: (e: React.DragEvent) => {
      depth.current = 0;
      setOver(false);
      if (disabled || !hasFiles(e)) return;
      e.preventDefault();
      choose(e.dataTransfer.files[0]);
    },
  };
  const highlight = over && 'border-primary bg-primary/5 hover:bg-primary/5';

  return (
    <div className="flex flex-col gap-1.5">
      {label && <Label htmlFor={zoneId}>{label}</Label>}
      <input
        ref={inputRef} type="file" accept=".xlsx" className="sr-only" tabIndex={-1} aria-hidden="true"
        disabled={disabled} onChange={(e) => choose(e.target.files?.[0])}
      />
      {file ? (
        <div
          data-contain data-dropzone {...dropTarget}
          className={cn(
            'flex min-h-11 items-center gap-3 rounded-lg border bg-card py-1.5 pr-1.5 pl-3 transition-colors lg:min-h-9',
            highlight,
          )}
        >
          <FileSpreadsheet className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="flex min-w-0 flex-1 flex-col">
            <p className="truncate font-medium" title={file.name}>{file.name}</p>
            <p className="text-xs text-muted-foreground tabular-nums" data-nowrap>{formatFileSize(file.size)}</p>
          </div>
          {/* aria-disabled, а не disabled: пока файл читается, фокус остаётся на кнопке, а не падает на <body>. */}
          <Button
            ref={removeRef} type="button" variant="ghost" size="icon"
            className="size-11 aria-disabled:pointer-events-none aria-disabled:opacity-50 lg:size-9"
            aria-label="Убрать файл" aria-disabled={disabled || undefined} onClick={clear}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
      ) : (
        <button
          ref={zoneRef} id={zoneId} type="button" disabled={disabled} aria-label="Выбрать файл .xlsx"
          data-allow-wrap data-dropzone {...dropTarget}
          onClick={() => inputRef.current?.click()}
          className={cn(
            'flex min-h-32 w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed',
            'border-border px-4 py-6 text-center transition-colors outline-none',
            'hover:bg-muted/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
            'disabled:pointer-events-none disabled:opacity-50',
            highlight,
          )}
        >
          <FileSpreadsheet className="size-8 text-muted-foreground" aria-hidden="true" />
          <span className="font-medium">Перетащите файл .xlsx сюда</span>
          <span className="text-sm text-muted-foreground">или</span>
          <span className={cn(buttonVariants({ variant: 'outline' }), 'h-11 lg:h-9')}>Выбрать файл</span>
        </button>
      )}
    </div>
  );
}
