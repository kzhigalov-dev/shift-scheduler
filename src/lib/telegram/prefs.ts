/** Настройки уведомлений. Граница ввода: jsonb из базы и значения формы (`unknown` здесь оправдан). */
export type RawPrefs = unknown;

export type WorkerPrefs = {
  assignments: boolean; decisions: boolean; time: boolean; published: boolean; free: boolean;
  evening: '18:00' | '20:00' | 'off'; before: 0 | 2 | 3 | 4;
};
export type ManagerPrefs = { signups: boolean; cancels: boolean; understaffed: boolean };

export type WorkerKind =
  | 'assigned' | 'removed' | 'cancel_approved' | 'kept' | 'event_cancelled'
  | 'rejected' | 'time_changed' | 'published' | 'free_place';

export const DEFAULT_WORKER_PREFS: WorkerPrefs = {
  assignments: true, decisions: true, time: true, published: true, free: true, evening: '18:00', before: 3,
};
export const DEFAULT_MANAGER_PREFS: ManagerPrefs = { signups: true, cancels: true, understaffed: true };

export const WORKER_KIND_PREF: Record<WorkerKind, 'assignments' | 'decisions' | 'time' | 'published' | 'free'> = {
  assigned: 'assignments', removed: 'assignments', cancel_approved: 'assignments', kept: 'assignments',
  event_cancelled: 'assignments', rejected: 'decisions', time_changed: 'time', published: 'published', free_place: 'free',
};

const obj = (raw: RawPrefs): Record<string, unknown> =>
  typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);

export function parseWorkerPrefs(raw: RawPrefs): WorkerPrefs {
  const v = obj(raw);
  const d = DEFAULT_WORKER_PREFS;
  return {
    assignments: bool(v.assignments, d.assignments),
    decisions: bool(v.decisions, d.decisions),
    time: bool(v.time, d.time),
    published: bool(v.published, d.published),
    free: bool(v.free, d.free),
    evening: v.evening === '18:00' || v.evening === '20:00' || v.evening === 'off' ? v.evening : d.evening,
    before: v.before === 0 || v.before === 2 || v.before === 3 || v.before === 4 ? v.before : d.before,
  };
}

export function parseManagerPrefs(raw: RawPrefs): ManagerPrefs {
  const v = obj(raw);
  const d = DEFAULT_MANAGER_PREFS;
  return { signups: bool(v.signups, d.signups), cancels: bool(v.cancels, d.cancels), understaffed: bool(v.understaffed, d.understaffed) };
}
