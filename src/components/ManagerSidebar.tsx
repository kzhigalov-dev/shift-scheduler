'use client';

import { useRef, useState, type Ref } from 'react';
import {
  Bell,
  BookOpen,
  BriefcaseBusiness,
  CalendarDays,
  LogOut,
  Menu,
  Upload,
  Tags,
  Users,
  Wallet,
} from 'lucide-react';
import { logoutManager } from '@/app/login/actions';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { BrandLockup } from './BrandLockup';
import { SidebarNav, type NavItem } from './SidebarNav';

const NAV_ITEMS: NavItem[] = [
  { href: '/month', label: 'Месяц', icon: CalendarDays, also: ['/event'] },
  { href: '/workers', label: 'Работники', icon: Users },
  { href: '/event-types', label: 'Виды мероприятий', icon: Tags },
  { href: '/positions', label: 'Должности', icon: BriefcaseBusiness },
  { href: '/pay', label: 'Оплата', icon: Wallet },
  { href: '/import', label: 'Импорт', icon: Upload },
  { href: '/telegram', label: 'Уведомления', icon: Bell },
  { href: '/instructions', label: 'Инструкции', icon: BookOpen },
];

function SidebarContent({ onNavigate, navRef }: { onNavigate?: () => void; navRef?: Ref<HTMLElement> }) {
  return (
    <div className="flex h-full flex-col gap-4 p-3">
      <BrandLockup markClassName="text-sidebar-primary" className="px-2 pt-2 pb-1" />
      <SidebarNav items={NAV_ITEMS} onNavigate={onNavigate} navRef={navRef} />
      <form action={logoutManager}>
        <Button type="submit" variant="ghost" className="h-11 w-full justify-start gap-2 text-muted-foreground lg:h-9">
          <LogOut className="size-4" aria-hidden="true" /> Выйти
        </Button>
      </form>
    </div>
  );
}

/**
 * Меню менеджера. По умолчанию — содержимое бокового меню (его обёртка в
 * ManagerShell). `mobile-trigger` — верхняя строка узкого экрана с кнопкой,
 * открывающей то же меню в выдвижной шторке.
 */
export function ManagerSidebar({ variant = 'sidebar' }: { variant?: 'sidebar' | 'mobile-trigger' }) {
  const [open, setOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);

  if (variant === 'sidebar') return <SidebarContent />;

  return (
    <div className="sticky top-0 z-40 flex h-12 shrink-0 items-center gap-2 border-b bg-sidebar px-2 lg:hidden">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button type="button" variant="ghost" size="icon-lg" aria-label="Открыть меню">
            <Menu className="size-5" aria-hidden="true" />
          </Button>
        </SheetTrigger>
        <SheetContent
          side="left"
          showCloseButton={false}
          className="bg-sidebar p-0"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            navRef.current?.querySelector('a')?.focus();
          }}
        >
          <SheetTitle className="sr-only">Меню</SheetTitle>
          <SheetDescription className="sr-only">Разделы приложения менеджера</SheetDescription>
          <SidebarContent onNavigate={() => setOpen(false)} navRef={navRef} />
        </SheetContent>
      </Sheet>
      <BrandLockup size="sm" markClassName="text-sidebar-primary" />
    </div>
  );
}
