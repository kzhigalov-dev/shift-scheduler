'use client';

import { Fragment } from 'react';
import { Button } from '@/components/ui/button';
import { useRunAction } from '@/components/useRunAction';
import { applyEventTemplateAction } from './actions';

/** Строка над составом будущего мероприятия, если применение шаблона его вида что-то изменило бы. */
export function TemplateNotice({ eventId, typeName, labels }: {
  eventId: string;
  typeName: string;
  labels: string[];
}) {
  const [pending, run] = useRunAction();
  return (
    <div data-contain className="mb-3 flex flex-col gap-3 rounded-lg border bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="min-w-0 break-words" data-allow-wrap>
        Состав отличается от шаблона «{typeName}»:{' '}
        {labels.map((l, i) => {
          // «ЗАЛ 3 → 2» не разрывается; пояснение в скобках переносится как обычный текст, запятая — с пунктом.
          const [, core, note = ''] = /^(.*?)( \(.*\))?$/.exec(l) ?? [l, l];
          return (
            <Fragment key={l}>
              {i > 0 && ' '}<span className="whitespace-nowrap">{core}</span>{note}{i < labels.length - 1 && ','}
            </Fragment>
          );
        })}
      </p>
      <Button
        type="button" variant="outline" disabled={pending} className="h-11 shrink-0 lg:h-9"
        onClick={() => run(() => applyEventTemplateAction(eventId),
          (r) => (r.applied > 0 ? 'Состав обновлён' : 'Состав уже соответствует шаблону'))}
      >
        Применить шаблон
      </Button>
    </div>
  );
}
