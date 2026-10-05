'use client';

import { useRef, useState } from 'react';
import { useRunAction } from '@/components/useRunAction';
import { PrefToggle } from '@/components/PrefControls';
import { TelegramDisconnect } from '@/components/TelegramConnect';
import type { ManagerPrefs } from '@/lib/telegram/prefs';
import { disconnectManagerTelegramAction, saveManagerPrefsAction } from './actions';

const TOGGLES: ReadonlyArray<{ key: keyof ManagerPrefs; label: string }> = [
  { key: 'signups', label: 'Новые заявки' },
  { key: 'cancels', label: 'Кто не сможет выйти' },
  { key: 'understaffed', label: 'Нехватка людей (в 12:00)' },
];

/** Настройки менеджера. Каждое изменение сохраняется сразу; при ошибке возвращается последнее сохранённое. */
export function ManagerNotificationSettings({ initial }: { initial: ManagerPrefs }) {
  const [prefs, setPrefs] = useState(initial);
  const saved = useRef(initial);
  const [, run] = useRunAction();

  function change(next: ManagerPrefs) {
    setPrefs(next);
    run(
      () => saveManagerPrefsAction(JSON.stringify(next)),
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
      <div>
        <TelegramDisconnect disconnect={disconnectManagerTelegramAction} />
      </div>
    </div>
  );
}
