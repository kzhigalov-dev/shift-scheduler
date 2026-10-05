'use client';

import { BookOpen, Bell, CalendarCheck, Hand, Wallet } from 'lucide-react';
import { BrandLockup } from './BrandLockup';
import { SidebarNav, type NavItem } from './SidebarNav';

const ITEMS: NavItem[] = [
  { href: '/shifts', label: 'Смены', icon: CalendarCheck },
  { href: '/available', label: 'Свободные', icon: Hand },
  { href: '/earnings', label: 'Заработок', icon: Wallet },
  { href: '/instructions', label: 'Памятка', icon: BookOpen },
  { href: '/notifications', label: 'Уведомления', icon: Bell },
];

/** Боковое меню работника на мониторе. Выхода нет: вход — по личной ссылке. */
export function WorkerSidebar() {
  return (
    <div className="flex h-full flex-col gap-4 p-3">
      <BrandLockup markClassName="text-sidebar-primary" className="px-2 pt-2 pb-1" />
      <SidebarNav items={ITEMS} />
    </div>
  );
}
