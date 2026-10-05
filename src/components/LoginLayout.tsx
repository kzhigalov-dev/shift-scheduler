import { BrandMark } from './BrandMark';

/** Экран входа: марка сверху, карточки по центру, адрес снизу (вход, подтверждение входа работника). */
export function LoginLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative isolate flex flex-1 flex-col items-center justify-center gap-8 overflow-hidden px-4 py-12">
      {/* Фон: очень бледный крупный силуэт колокольни за карточкой — только декор. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute bottom-0 left-1/2 -z-10 h-[min(88vh,780px)] -translate-x-1/2 sm:translate-x-[40%] lg:translate-x-[80%]"
      >
        <BrandMark size={780} tight className="h-full w-auto text-primary opacity-[0.07]" />
      </div>
      <div className="flex flex-col items-center gap-3 text-center">
        <BrandMark size={64} tight className="text-primary" />
        <div className="flex flex-col gap-0.5">
          <p className="font-brand text-[28px] leading-tight font-semibold">Анненкирхе</p>
          <p className="text-sm text-muted-foreground">смены</p>
        </div>
      </div>

      <div className="flex w-full flex-col items-center gap-4">{children}</div>

      <p className="text-xs text-muted-foreground">{'Кирочная ул., 8'}</p>
    </main>
  );
}
