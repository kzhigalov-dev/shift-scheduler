'use client';
import Link from 'next/link';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { EventTypeOption } from '@/lib/eventTypes/types';
export function EventTypeSelect({id,options,value,onChange}: {
  id:string;options:EventTypeOption[];value:string;onChange:(value:string)=>void;
}) {
  if (options.length===0) return <p className="text-sm text-muted-foreground" data-allow-wrap>
    Нет активных видов. <Link href="/event-types" className="underline">Добавьте вид или восстановите его из архива</Link>.
  </p>;
  return <>
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} title={options.find(o=>o.id===value)?.name} className="w-full min-w-0 data-[size=default]:h-11 lg:data-[size=default]:h-9 [&>span]:min-w-0 [&>span]:truncate"><SelectValue className="min-w-0 flex-1 truncate text-left" style={{display:'block'}}>{options.find(o=>o.id===value)?.name}</SelectValue></SelectTrigger>
      <SelectContent className="max-w-[calc(100vw-2rem)]">
        {options.map(o=><SelectItem key={o.id} value={o.id} className="whitespace-normal [&>span:last-child]:min-w-0 [&>span:last-child]:flex-1" data-allow-wrap><span className="min-w-0 break-words">{o.name}</span></SelectItem>)}
      </SelectContent>
    </Select>
    <input type="hidden" name="eventTypeId" value={value} />
    <input type="hidden" name="tag" value={options.find(o=>o.id===value)?.tag??'regular'} />
  </>;
}
