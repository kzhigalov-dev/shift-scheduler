'use client';

import { useRef, useState } from 'react';
import { useRunAction } from '@/components/useRunAction';
import { PrefSelect, PrefToggle } from '@/components/PrefControls';
import { TelegramDisconnect } from '@/components/TelegramConnect';
import type { WorkerPrefs } from '@/lib/telegram/prefs';
import { disconnectTelegramAction, saveWorkerPrefsAction } from './actions';

const TOGGLES: ReadonlyArray<{ key: 'assignments' | 'decisions' | 'time' | 'published' | 'free'; label: string }> = [
  { key: 'assignments', label: 'Назначения и снятия' },
  { key: 'decisions', label: 'Решения по заявкам' },
  { key: 'time', label: 'Изменение времени' },
  { key: 'published', label: 'Новый месяц' },
  { key: 'free', label: 'Свободные места' },
];

const EVENING = [
  { value: '18:00', label: '18:00' },
  { value: '20:00', label: '20:00' },
  { value: 'off', label: 'Не нужно' },
] as const;

const BEFORE = [
  { value: '2', label: 'За 2 часа' },
  { value: '3', label: 'За 3 часа' },
  { value: '4', label: 'За 4 часа' },
  { value: '0', label: 'Не нужно' },
] as const;

/** Настройки работника. Каждое изменение сохраняется сразу; при ошибке возвращается последнее сохранённое. */
export function NotificationSettings({ initial }: { initial: WorkerPrefs }) {
  const [prefs, setPrefs] = useState(initial);
  const saved = useRef(initial);
  const [, run] = useRunAction();

  function change(next: WorkerPrefs) {
    setPrefs(next);
    run(
      () => saveWorkerPrefsAction(JSON.stringify(next)),
      'Сохранено',
      () => { saved.current = next; },
      { onError: () => setPrefs(saved.current) },
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col">
        {TOGGLES.map(({ key, label }) => (
          <PrefToggle key={key} label={label} checked={prefs[key]} onChange={(value) => change({ ...prefs, [key]: value })} />
        ))}
      </div>
      <div className="flex flex-col gap-3">
        <PrefSelect
          label="Напоминание накануне" value={prefs.evening} options={EVENING}
          onChange={(value) => change({ ...prefs, evening: value === '18:00' || value === '20:00' ? value : 'off' })}
        />
        <PrefSelect
          label="Напоминание перед сменой" value={String(prefs.before)} options={BEFORE}
          onChange={(value) => change({ ...prefs, before: value === '2' ? 2 : value === '3' ? 3 : value === '4' ? 4 : 0 })}
        />
      </div>
      <div>
        <TelegramDisconnect
          disconnect={disconnectTelegramAction}
          description="Уведомления перестанут приходить. Входы в приложение из бота на других устройствах закроются, в этом браузере вход останется."
        />
      </div>
    </div>
  );
}
