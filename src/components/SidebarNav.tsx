'use client';

import type { Ref } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Дополнительные префиксы путей, которые тоже относятся к пункту. */
  also?: string[];
};

export function isNavActive(pathname: string, item: NavItem): boolean {
  return [item.href, ...(item.also ?? [])].some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/** Пункты бокового меню — общие для менеджера и работника. */
export function SidebarNav({ items, onNavigate, navRef }: {
  items: NavItem[]; onNavigate?: () => void; navRef?: Ref<HTMLElement>;
}) {
  const pathname = usePathname();
  return (
    <nav ref={navRef} aria-label="Разделы" className="flex flex-1 flex-col gap-0.5">
      {items.map((item) => {
        const active = isNavActive(pathname, item);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex h-11 items-center gap-2 rounded-lg px-2 text-sm text-sidebar-foreground outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-3 focus-visible:ring-sidebar-ring/50 lg:h-9',
              active && 'bg-sidebar-accent font-medium',
            )}
          >
            <item.icon className={cn('size-4 shrink-0', active && 'text-sidebar-primary')} aria-hidden="true" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
