import { ManagerSidebar } from './ManagerSidebar';

/** Каркас экранов менеджера: боковое меню на ноутбуке, шторка на узком экране. */
export function ManagerShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 border-r bg-sidebar lg:block">
        <div className="sticky top-0 h-screen">
          <ManagerSidebar />
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <ManagerSidebar variant="mobile-trigger" />
        <main className="mx-auto w-full max-w-[1200px] px-4 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
