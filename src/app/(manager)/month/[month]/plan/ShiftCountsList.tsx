/** Список «Смены в месяце»: работник и число его смен, по убыванию. */
export function ShiftCountsList({ counts, names }: {
  counts: Array<[string, number]>; names: ReadonlyMap<string, string>;
}) {
  if (counts.length === 0) return <p className="text-sm text-muted-foreground">Пока никого.</p>;
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {counts.map(([id, n]) => (
        <li key={id} className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate" title={names.get(id)}>{names.get(id) ?? 'Работник в архиве'}</span>
          <span className="shrink-0 tabular-nums text-muted-foreground">{n}</span>
        </li>
      ))}
    </ul>
  );
}
