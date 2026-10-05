'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BookOpen, CalendarCheck, Hand, Wallet } from 'lucide-react';
import { cn } from '@/lib/utils';

const NAV_ITEMS = [
  { href: '/shifts', label: 'Смены', icon: CalendarCheck },
  { href: '/available', label: 'Свободные', icon: Hand },
  { href: '/earnings', label: 'Заработок', icon: Wallet },
  { href: '/instructions', label: 'Памятка', icon: BookOpen },
] as const;

/** Нижняя панель работника: четыре вкладки, подпись — одно слово в одну строку. */
export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Разделы"
      className="fixed inset-x-0 bottom-0 z-10 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
    >
      <div className="mx-auto grid max-w-md grid-cols-4">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname?.startsWith(href) ?? false;
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex min-w-0 flex-col items-center gap-0.5 py-2 outline-none focus-visible:bg-muted',
                active ? 'text-primary' : 'text-muted-foreground',
              )}
            >
              <Icon className="size-5" aria-hidden="true" />
              <span className="whitespace-nowrap text-xs font-medium">{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
