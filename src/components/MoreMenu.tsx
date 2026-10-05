import Link from 'next/link';
import { Ellipsis, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

/**
 * download — ссылка на файл (Route Handler): обычный <a download>, без next/link и предзагрузки.
 * className — на пункт меню, например `sm:hidden` у ссылки, которая на широком экране уже есть в шапке.
 */
export type MoreItem = { label: string; href: string; icon: LucideIcon; download?: boolean; className?: string };

// Не 'use client': иконки в items — функции, из серверной страницы в клиентский компонент они не передаются.
/**
 * «⋯» в шапке: ссылки, которым не хватило места на узком экране, и редкие действия вроде скачивания.
 * children — пункты-действия (клиентские компоненты с DropdownMenuItem, например открывающие окно), перед ссылками.
 */
export function MoreMenu({ items, className, children }: { items: MoreItem[]; className?: string; children?: React.ReactNode }) {
  if (items.length === 0 && !children) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="icon" className={className ?? 'size-11 lg:size-9'} aria-label="Ещё">
          <Ellipsis aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-44">
        {children}
        {items.map(({ label, href, icon: Icon, download, className: itemClassName }) => (
          <DropdownMenuItem key={label} asChild className={cn('h-11 lg:h-9', itemClassName)}>
            {download
              ? <a href={href} download><Icon aria-hidden="true" />{label}</a>
              : <Link href={href}><Icon aria-hidden="true" />{label}</Link>}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
