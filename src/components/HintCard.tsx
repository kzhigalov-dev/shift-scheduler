import { Illustration, type IllustrationName } from './Illustration';

/**
 * Карточка-подсказка в колонке справа (от 1280 px): маленькая иллюстрация, заголовок,
 * короткие пункты или свой текст, необязательное действие.
 */
export function HintCard({ title, illustration, items, children, action }: {
  title: string; illustration?: IllustrationName; items?: React.ReactNode[];
  children?: React.ReactNode; action?: React.ReactNode;
}) {
  return (
    <section data-contain data-allow-wrap className="flex flex-col gap-2 rounded-xl border bg-card p-4">
      {illustration ? <Illustration name={illustration} size={96} className="-mt-1 mb-1" /> : null}
      <h2 className="font-medium">{title}</h2>
      {items?.length ? (
        <ul className="flex list-disc flex-col gap-1.5 pl-4 text-muted-foreground marker:text-primary">
          {items.map((item, i) => <li key={i}>{item}</li>)}
        </ul>
      ) : null}
      {children}
      {action ? <div className="mt-1">{action}</div> : null}
    </section>
  );
}
