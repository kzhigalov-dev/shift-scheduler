import { useState } from "react";
import {
  CalendarDays,
  Users,
  Wallet,
  Shapes,
  CalendarCheck,
  ChevronLeft,
  ChevronRight,
  Plus,
  RotateCcw,
  Bell,
  Code2,
  BookOpen,
} from "lucide-react";
import { Toaster } from "sonner";
import { BrandLockup } from "@/components/BrandLockup";
import { Illustration } from "@/components/Illustration";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useRunAction } from "@/components/useRunAction";
import { formatMoney, formatDate, formatCount } from "@/lib/format";
import {
  initialState,
  readState,
  rateFor,
  toggleSignup,
  updateType,
  STORAGE_KEY,
  DEMO_MONTH,
  type DemoState,
  type DemoEvent,
  type DemoType,
} from "./model";

const card = "rounded-xl border bg-card p-5";
const control = "h-11 lg:h-9";
type Page =
  "month" | "workers" | "types" | "pay" | "shifts" | "available" | "guide";
const labels: Record<Page, string> = {
  month: "Месяц",
  workers: "Работники",
  types: "Виды мероприятий",
  pay: "Оплата",
  shifts: "Смены",
  available: "Свободные места",
  guide: "Памятка",
};
const icons = {
  month: CalendarDays,
  workers: Users,
  types: Shapes,
  pay: Wallet,
  shifts: CalendarCheck,
  available: CalendarDays,
  guide: BookOpen,
};
function load() {
  try {
    return readState(localStorage.getItem(STORAGE_KEY));
  } catch {
    return initialState();
  }
}
function monthLabel(month: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${month}-01T12:00:00Z`));
}
function moveMonth(month: string, step: number) {
  const d = new Date(`${month}-01T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + step);
  return d.toISOString().slice(0, 7);
}

export function App() {
  const [state, setState] = useState(load);
  const [role, setRole] = useState<"manager" | "worker">("manager");
  const [page, setPage] = useState<Page>("month");
  const [month, setMonth] = useState(DEMO_MONTH);
  const [event, setEvent] = useState<DemoEvent | null>(null);
  const [type, setType] = useState<DemoType | null>(null);
  const [notifications, setNotifications] = useState(false);
  const [reset, setReset] = useState(false);
  const [pending, run] = useRunAction();
  function commit(next: DemoState, message: string) {
    run(async () => {
      setState(next);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        return {
          error:
            "Изменения применены на экране, но браузер не разрешает их сохранить.",
        };
      }
      return { error: null };
    }, message);
  }
  const events = state.events
    .filter((e) => e.date.startsWith(month))
    .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
  const myEvents = events.filter((e) => e.signups.includes("worker-1"));
  const totalPay = myEvents.reduce((sum, e) => sum + rateFor(state, e), 0);
  const pages: Page[] =
    role === "manager"
      ? ["month", "workers", "types", "pay"]
      : ["shifts", "available", "pay", "guide"];
  function changeRole(value: "manager" | "worker") {
    setRole(value);
    setPage(value === "manager" ? "month" : "shifts");
    setEvent(null);
    setType(null);
  }
  function newEvent() {
    setEvent({
      id: crypto.randomUUID(),
      date: `${month}-15`,
      time: "19:00",
      title: "",
      program: "",
      performers: "",
      typeId: state.types[0].id,
      rate: null,
      signups: [],
    });
  }
  const filled = events.reduce((n, e) => n + e.signups.length, 0);
  const seats = events.reduce(
    (n, e) => n + (state.types.find((t) => t.id === e.typeId)?.seats ?? 0),
    0,
  );
  const free = events.filter(
    (e) =>
      e.signups.length <
      (state.types.find((t) => t.id === e.typeId)?.seats ?? 0),
  );
  const title =
    page === "pay" && role === "worker" ? "Заработок" : labels[page];
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-card focus:p-3"
      >
        К содержимому
      </a>
      <div
        className="border-b bg-secondary px-4 py-2 text-xs text-muted-foreground"
        data-allow-wrap
      >
        Демонстрация · Все данные вымышлены. Изменения сохраняются только в
        вашем браузере.
      </div>
      <div className="flex min-h-[calc(100vh-34px)] flex-col lg:flex-row">
        <aside className="border-b bg-sidebar lg:w-60 lg:shrink-0 lg:border-r lg:border-b-0">
          <div className="lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col">
            <div className="flex items-center justify-between gap-3 px-5 py-5">
              <BrandLockup />
              <StatusBadge tone="neutral">Демо</StatusBadge>
            </div>
            <nav
              className="demo-nav"
              key={role}
              aria-label="Основная навигация"
              data-layout-scroll
            >
              {pages.map((p) => {
                const Icon = icons[p];
                return (
                  <button
                    key={p}
                    aria-current={page === p ? "page" : undefined}
                    onClick={() => setPage(p)}
                  >
                    <Icon size={18} aria-hidden />
                    {p === "pay" && role === "worker" ? "Заработок" : labels[p]}
                  </button>
                );
              })}
            </nav>
            <div className="hidden flex-1 lg:block" />
            <div className="hidden p-5 lg:block">
              <Illustration name="tower" size={150} />
              <p className="mt-3 text-xs text-muted-foreground">
                Планирование смен
                <br />с заботой о людях.
              </p>
              <a
                className="mt-4 flex items-center gap-2 text-xs underline underline-offset-4"
                href="https://github.com/kzhigalov-dev/shift-scheduler"
                target="_blank"
                rel="noreferrer"
              >
                <Code2 size={15} aria-hidden />
                Исходный код
              </a>
            </div>
          </div>
        </aside>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 lg:px-8">
            <fieldset className="flex items-center gap-1 rounded-lg bg-muted p-1">
              <legend className="sr-only">Кабинет</legend>
              {(["manager", "worker"] as const).map((r) => (
                <Button
                  key={r}
                  className={control}
                  variant={role === r ? "default" : "ghost"}
                  aria-pressed={role === r}
                  onClick={() => changeRole(r)}
                >
                  {r === "manager" ? "Менеджер" : "Работник"}
                </Button>
              ))}
            </fieldset>
            <div className="flex gap-2">
              <Button
                className={control}
                variant="outline"
                onClick={() => setReset(true)}
              >
                <RotateCcw size={16} aria-hidden />
                Сбросить демо
              </Button>
              {role === "worker" && (
                <Button
                  className={control}
                  variant="outline"
                  aria-label="Уведомления"
                  onClick={() => setNotifications(true)}
                >
                  <Bell size={17} aria-hidden />
                </Button>
              )}
            </div>
          </div>
          <main
            id="main"
            className="mx-auto max-w-[1320px] px-4 py-6 lg:px-8 lg:py-8"
          >
            <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="mb-1 text-sm text-muted-foreground">
                  {role === "worker"
                    ? "Здравствуйте, Алексей"
                    : "Кабинет менеджера"}
                </p>
                <h1 className="text-2xl font-semibold tracking-tight lg:text-3xl">
                  {title}
                </h1>
              </div>
              {!["types", "workers", "guide"].includes(page) && (
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    className={control}
                    aria-label="Предыдущий месяц"
                    onClick={() => setMonth(moveMonth(month, -1))}
                  >
                    <ChevronLeft size={16} aria-hidden />
                  </Button>
                  <span className="min-w-32 text-center font-medium capitalize">
                    {monthLabel(month)}
                  </span>
                  <Button
                    variant="outline"
                    className={control}
                    aria-label="Следующий месяц"
                    onClick={() => setMonth(moveMonth(month, 1))}
                  >
                    <ChevronRight size={16} aria-hidden />
                  </Button>
                </div>
              )}
            </header>
            {page === "month" && (
              <>
                <div className="mb-5 grid gap-3 sm:grid-cols-3">
                  <Stat
                    label="Мероприятий в месяце"
                    value={formatCount(events.length, [
                      "мероприятие",
                      "мероприятия",
                      "мероприятий",
                    ])}
                  />
                  <Stat
                    label="Заполненность"
                    value={`${filled} / ${seats}`}
                    note="мест занято"
                  />
                  <Stat
                    label="Нужны люди"
                    value={formatCount(free.length, [
                      "мероприятие",
                      "мероприятия",
                      "мероприятий",
                    ])}
                  />
                </div>
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-muted-foreground">
                    Нажмите на мероприятие, чтобы посмотреть состав и ставки.
                  </p>
                  <Button className={control} onClick={newEvent}>
                    <Plus size={16} aria-hidden />
                    Добавить мероприятие
                  </Button>
                </div>
                <Calendar
                  month={month}
                  events={events}
                  state={state}
                  onOpen={setEvent}
                />
              </>
            )}
            {page === "workers" && (
              <>
                <div className="mb-5 grid gap-3 sm:grid-cols-3">
                  <Stat
                    label="Команда"
                    value={formatCount(state.workers.length, [
                      "работник",
                      "работника",
                      "работников",
                    ])}
                  />
                  <Stat
                    label="Задействованы в месяце"
                    value={String(
                      new Set(events.flatMap((e) => e.signups)).size,
                    )}
                  />
                  <Stat label="Всего назначений" value={String(filled)} />
                </div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {state.workers.map((w) => (
                    <section className={card} key={w.id} data-contain>
                      <div className="mb-3 flex items-center gap-3">
                        <div className="flex size-10 items-center justify-center rounded-full bg-secondary font-medium text-primary">
                          {w.name
                            .split(" ")
                            .map((n) => n[0])
                            .join("")}
                        </div>
                        <h2 className="font-semibold">{w.name}</h2>
                      </div>
                      <StatusBadge tone="neutral">{w.position}</StatusBadge>
                      <p className="mt-3 text-sm text-muted-foreground">
                        {formatCount(
                          events.filter((e) => e.signups.includes(w.id)).length,
                          ["смена", "смены", "смен"],
                        )}{" "}
                        в месяце
                      </p>
                    </section>
                  ))}
                </div>
              </>
            )}
            {page === "types" && (
              <>
                <div className="mb-5 flex flex-wrap justify-between gap-3">
                  <p className="max-w-xl text-muted-foreground">
                    Вид задаёт состав и ставку. Ручная ставка отдельного
                    мероприятия имеет приоритет.
                  </p>
                  <Button
                    className={control}
                    onClick={() =>
                      setType({
                        id: crypto.randomUUID(),
                        name: "",
                        seats: 4,
                        rate: 1500,
                      })
                    }
                  >
                    <Plus size={16} aria-hidden />
                    Добавить вид
                  </Button>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {state.types.map((t) => (
                    <section key={t.id} className={card} data-contain>
                      <Illustration
                        name={t.id === "organ" ? "organ" : "notes"}
                        size={100}
                      />
                      <h2
                        className="mt-3 text-lg font-semibold break-words"
                        data-allow-wrap
                      >
                        {t.name}
                      </h2>
                      <p className="my-3 text-sm text-muted-foreground">
                        {formatCount(t.seats, ["место", "места", "мест"])} ·{" "}
                        {formatMoney(t.rate)}
                      </p>
                      <Button
                        className={control}
                        variant="outline"
                        onClick={() => setType(t)}
                      >
                        Редактировать
                      </Button>
                    </section>
                  ))}
                </div>
              </>
            )}
            {(page === "shifts" || page === "available") && (
              <>
                {page === "shifts" && (
                  <>
                    <div className="mb-5 grid gap-3 sm:grid-cols-3">
                      <Stat
                        label="Смены в месяце"
                        value={String(myEvents.length)}
                      />
                      <Stat label="Заработок" value={formatMoney(totalPay)} />
                      <Stat
                        label="Можно записаться"
                        value={String(
                          free.filter((e) => !e.signups.includes("worker-1"))
                            .length,
                        )}
                      />
                    </div>
                    {myEvents[0] && (
                      <section
                        className={`${card} mb-5 flex justify-between gap-5`}
                        data-contain
                      >
                        <div>
                          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                            Ближайшая смена в месяце
                          </p>
                          <h2 className="mt-2 text-xl font-semibold">
                            {myEvents[0].title}
                          </h2>
                          <p className="my-2">
                            {formatDate(myEvents[0].date)} · {myEvents[0].time}
                          </p>
                          <p className="mb-4 text-sm text-muted-foreground">
                            Приходите за 30 минут до начала.
                          </p>
                          <Button
                            className={control}
                            variant="outline"
                            onClick={() => setEvent(myEvents[0])}
                          >
                            Подробнее
                          </Button>
                        </div>
                        <Illustration
                          name="tower"
                          size={180}
                          className="hidden sm:block"
                        />
                      </section>
                    )}
                  </>
                )}
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {(page === "shifts" ? myEvents : free).map((e) => (
                    <section
                      key={e.id}
                      className={`${card} flex flex-col`}
                      data-contain
                    >
                      <p className="mb-2 text-sm text-muted-foreground">
                        {formatDate(e.date, { weekday: "short" })} · {e.time}
                      </p>
                      <h2 className="mb-3 text-lg font-semibold">{e.title}</h2>
                      <p className="mb-4 text-sm text-muted-foreground">
                        {state.types.find((t) => t.id === e.typeId)?.name} ·{" "}
                        {formatMoney(rateFor(state, e))}
                      </p>
                      <div className="mt-auto flex flex-wrap gap-2">
                        <Button
                          className={control}
                          variant="outline"
                          onClick={() => setEvent(e)}
                        >
                          Подробнее
                        </Button>
                        <Button
                          className={control}
                          variant={
                            e.signups.includes("worker-1")
                              ? "secondary"
                              : "default"
                          }
                          disabled={pending}
                          onClick={() =>
                            commit(
                              toggleSignup(state, e.id),
                              e.signups.includes("worker-1")
                                ? "Запись отменена в демо"
                                : "Вы записались в демо",
                            )
                          }
                        >
                          {e.signups.includes("worker-1")
                            ? "Отменить запись"
                            : "Записаться"}
                        </Button>
                      </div>
                    </section>
                  ))}
                </div>
                {!(page === "shifts" ? myEvents : free).length && (
                  <Empty text="В этом месяце пока нет смен." />
                )}
              </>
            )}
            {page === "pay" && (
              <>
                <div className="mb-5 grid gap-3 sm:grid-cols-3">
                  <Stat
                    label={
                      role === "worker"
                        ? "Заработок за месяц"
                        : "Фонд оплаты месяца"
                    }
                    value={formatMoney(
                      role === "worker"
                        ? totalPay
                        : events.reduce(
                            (n, e) => n + rateFor(state, e) * e.signups.length,
                            0,
                          ),
                    )}
                  />
                  <Stat
                    label="Назначений"
                    value={String(role === "worker" ? myEvents.length : filled)}
                  />
                  <Stat label="Статус" value="Запланировано" />
                </div>
                {role === "worker" ? (
                  <>
                    <section className={`${card} mb-5`}>
                      <h2 className="mb-5 font-semibold">
                        Последние 6 месяцев
                      </h2>
                      <div className="flex h-40 items-end justify-around gap-3">
                        {[5000, 8000, 6500, 10000, 6000, totalPay].map(
                          (n, i) => (
                            <div
                              key={i}
                              className="flex flex-1 flex-col items-center gap-2"
                            >
                              <span className="text-[10px] text-muted-foreground">
                                {formatMoney(n)}
                              </span>
                              <div
                                className="w-full max-w-14 rounded-t bg-primary/70"
                                style={{
                                  height: `${Math.max(2, (n / Math.max(10000, totalPay)) * 100)}px`,
                                }}
                              />
                              <span className="text-xs text-muted-foreground">
                                {new Intl.DateTimeFormat("ru-RU", {
                                  month: "short",
                                  timeZone: "UTC",
                                }).format(
                                  new Date(
                                    `${moveMonth(month, i - 5)}-01T12:00:00Z`,
                                  ),
                                )}
                              </span>
                            </div>
                          ),
                        )}
                      </div>
                      <p className="mt-4 text-xs text-muted-foreground">
                        Предыдущие месяцы — пример истории; выбранный месяц
                        пересчитывается по вашим записям.
                      </p>
                    </section>
                    <div className="grid gap-3">
                      {myEvents.map((e) => (
                        <section
                          key={e.id}
                          className={`${card} flex justify-between gap-4`}
                        >
                          <div>
                            <h2 className="font-medium">{e.title}</h2>
                            <p className="mt-1 text-sm text-muted-foreground">
                              {formatDate(e.date)}
                            </p>
                          </div>
                          <strong className="whitespace-nowrap">
                            {formatMoney(rateFor(state, e))}
                          </strong>
                        </section>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="grid gap-3">
                    {state.workers.map((w) => (
                      <section
                        key={w.id}
                        className={`${card} flex flex-wrap items-center justify-between gap-3`}
                      >
                        <div>
                          <h2 className="font-medium">{w.name}</h2>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {w.position}
                          </p>
                        </div>
                        <strong>
                          {formatMoney(
                            events
                              .filter((e) => e.signups.includes(w.id))
                              .reduce((n, e) => n + rateFor(state, e), 0),
                          )}
                        </strong>
                      </section>
                    ))}
                  </div>
                )}
              </>
            )}
            {page === "guide" && (
              <section className={`${card} max-w-2xl`}>
                <Illustration name="candle" />
                <h2 className="mt-4 text-xl font-semibold">
                  Как устроена запись
                </h2>
                <ol className="mt-5 list-decimal space-y-4 pl-5">
                  <li>Откройте «Свободные места» и выберите мероприятие.</li>
                  <li>
                    Нажмите «Записаться». В демо смена сразу появится в вашем
                    списке.
                  </li>
                  <li>Проверьте время начала и приходите за 30 минут.</li>
                  <li>
                    Если планы изменились, отмените запись в разделе «Смены».
                  </li>
                </ol>
                <p className="mt-5 text-muted-foreground">
                  В рабочем приложении действуют подтверждение менеджера и
                  уведомления Telegram. Здесь показан упрощённый сценарий без
                  отправки сообщений.
                </p>
              </section>
            )}
            <footer className="mt-8 border-t pt-4 text-xs text-muted-foreground">
              Демо планировщика смен · Без подключения к базе и Telegram ·{" "}
              <a
                href="https://github.com/kzhigalov-dev/shift-scheduler"
                className="underline underline-offset-4"
              >
                Код проекта
              </a>
            </footer>
          </main>
        </div>
      </div>
      {event && (
        <EventDialog
          key={event.id}
          event={event}
          state={state}
          manager={role === "manager"}
          onClose={() => setEvent(null)}
          onSave={(next) => {
            commit(
              {
                ...state,
                events: state.events.some((e) => e.id === next.id)
                  ? state.events.map((e) => (e.id === next.id ? next : e))
                  : [...state.events, next],
              },
              "Мероприятие сохранено в демо",
            );
            setEvent(null);
          }}
          onDelete={() => {
            commit(
              {
                ...state,
                events: state.events.filter((e) => e.id !== event.id),
              },
              "Мероприятие удалено из демо",
            );
            setEvent(null);
          }}
        />
      )}
      {type && (
        <TypeDialog
          key={type.id}
          type={type}
          used={
            state.types.length <= 1 ||
            state.events.some((e) => e.typeId === type.id)
          }
          onClose={() => setType(null)}
          onSave={(next) => {
            commit(
              state.types.some((t) => t.id === next.id)
                ? updateType(state, next.id, next.name, next.rate, next.seats)
                : { ...state, types: [...state.types, next] },
              "Вид мероприятия сохранён в демо",
            );
            setType(null);
          }}
          onDelete={() => {
            commit(
              { ...state, types: state.types.filter((t) => t.id !== type.id) },
              "Вид удалён из демо",
            );
            setType(null);
          }}
        />
      )}
      <Dialog open={reset} onOpenChange={setReset}>
        <DialogContent>
          <DialogTitle>Сбросить демо?</DialogTitle>
          <DialogDescription>
            Ваши правки и записи будут заменены исходными вымышленными данными.
          </DialogDescription>
          <Button
            className={control}
            onClick={() => {
              commit(initialState(), "Демо сброшено");
              setMonth(DEMO_MONTH);
              setReset(false);
            }}
          >
            Сбросить
          </Button>
        </DialogContent>
      </Dialog>
      <Dialog open={notifications} onOpenChange={setNotifications}>
        <DialogContent>
          <DialogTitle>Уведомления</DialogTitle>
          <DialogDescription>Пример уведомлений работника.</DialogDescription>
          <div className="rounded-lg border p-3">
            <strong>Добро пожаловать в команду</strong>
            <p className="mt-2 text-sm text-muted-foreground">
              Открывайте свободные места и выбирайте удобные смены. В демо
              сообщения в Telegram не отправляются.
            </p>
          </div>
        </DialogContent>
      </Dialog>
      <Toaster richColors position="bottom-right" />
    </>
  );
}
function Stat({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <section className={card} data-contain>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight" data-allow-wrap>
        {value}
      </p>
      {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
    </section>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <div className={`${card} flex flex-col items-center py-12`}>
      <Illustration name="empty" />
      <p className="mt-4 text-muted-foreground">{text}</p>
    </div>
  );
}
function Calendar({
  month,
  events,
  state,
  onOpen,
}: {
  month: string;
  events: DemoEvent[];
  state: DemoState;
  onOpen: (e: DemoEvent) => void;
}) {
  const first = new Date(`${month}-01T12:00:00Z`);
  const offset = (first.getUTCDay() + 6) % 7;
  const days = new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return (
    <>
      <div className="hidden overflow-hidden rounded-xl border bg-card md:block">
        <div className="grid grid-cols-7 border-b bg-muted/50">
          {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((d) => (
            <div
              key={d}
              className="px-3 py-2 text-xs font-medium text-muted-foreground"
            >
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {Array.from(
            { length: Math.ceil((offset + days) / 7) * 7 },
            (_, i) => {
              const day = i - offset + 1;
              const dayEvents = events.filter(
                (e) => Number(e.date.slice(-2)) === day,
              );
              return (
                <div
                  key={i}
                  className="min-h-32 min-w-0 border-r border-b p-2 lg:min-h-36"
                  data-contain
                >
                  {day > 0 && day <= days && (
                    <>
                      <p
                        className={`mb-2 text-xs ${day === 6 && month === DEMO_MONTH ? "font-bold text-primary" : "text-muted-foreground"}`}
                      >
                        {day}
                      </p>
                      {dayEvents.map((e) => (
                        <button
                          key={e.id}
                          className="mb-1 block w-full rounded-md border-l-2 border-primary bg-secondary p-2 text-left hover:bg-accent"
                          onClick={() => onOpen(e)}
                        >
                          <span className="block text-xs font-medium">
                            {e.time}
                          </span>
                          <span
                            className="mt-1 block line-clamp-2 text-xs"
                            title={e.title}
                          >
                            {e.title}
                          </span>
                          <span className="mt-2 block text-[10px] text-muted-foreground">
                            {e.signups.length}/
                            {state.types.find((t) => t.id === e.typeId)?.seats}{" "}
                            мест
                          </span>
                        </button>
                      ))}
                    </>
                  )}
                </div>
              );
            },
          )}
        </div>
      </div>
      <div className="grid gap-3 md:hidden">
        {events.map((e) => (
          <button
            key={e.id}
            className={`${card} text-left`}
            onClick={() => onOpen(e)}
          >
            <p className="mb-2 text-xs text-muted-foreground">
              {formatDate(e.date, { weekday: "short" })} · {e.time}
            </p>
            <h2 className="font-semibold">{e.title}</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {e.signups.length}/
              {state.types.find((t) => t.id === e.typeId)?.seats} мест ·{" "}
              {formatMoney(rateFor(state, e))}
            </p>
          </button>
        ))}
      </div>
      {!events.length && (
        <Empty text="Мероприятий пока нет. Можно добавить своё." />
      )}
    </>
  );
}
function EventDialog({
  event,
  state,
  manager,
  onClose,
  onSave,
  onDelete,
}: {
  event: DemoEvent;
  state: DemoState;
  manager: boolean;
  onClose: () => void;
  onSave: (e: DemoEvent) => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState(event);
  function field<K extends keyof DemoEvent>(key: K, value: DemoEvent[K]) {
    setDraft({ ...draft, [key]: value });
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="max-h-[85dvh] overflow-y-auto sm:max-w-lg"
        data-contain
      >
        <DialogTitle>{manager ? "Мероприятие" : event.title}</DialogTitle>
        <DialogDescription>
          {manager
            ? "Правки применяются только в этой демоверсии."
            : `${formatDate(event.date)} · ${event.time} · ${formatMoney(rateFor(state, event))}`}
        </DialogDescription>
        {manager ? (
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (draft.title.trim())
                onSave({ ...draft, title: draft.title.trim() });
            }}
          >
            <label className="demo-label">
              Название
              <input
                autoFocus
                className="demo-input"
                required
                maxLength={160}
                value={draft.title}
                onChange={(e) => field("title", e.target.value)}
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="demo-label">
                Дата
                <input
                  type="date"
                  className="demo-input"
                  required
                  value={draft.date}
                  onChange={(e) => field("date", e.target.value)}
                />
              </label>
              <label className="demo-label">
                Время
                <input
                  type="time"
                  className="demo-input"
                  required
                  value={draft.time}
                  onChange={(e) => field("time", e.target.value)}
                />
              </label>
            </div>
            <label className="demo-label">
              Вид
              <select
                className="demo-input"
                value={draft.typeId}
                onChange={(e) => field("typeId", e.target.value)}
              >
                {state.types.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="demo-label">
              Программа
              <textarea
                className="demo-input"
                rows={3}
                maxLength={2000}
                value={draft.program}
                onChange={(e) => field("program", e.target.value)}
              />
            </label>
            <label className="demo-label">
              Исполнители
              <input
                className="demo-input"
                maxLength={500}
                value={draft.performers}
                onChange={(e) => field("performers", e.target.value)}
              />
            </label>
            <label className="demo-label">
              Отдельная ставка, ₽
              <input
                type="number"
                min={0}
                max={1000000}
                step={1}
                className="demo-input"
                placeholder={`По виду: ${rateFor(state, { ...draft, rate: null })}`}
                value={draft.rate ?? ""}
                onChange={(e) =>
                  field(
                    "rate",
                    e.target.value === "" ? null : Number(e.target.value),
                  )
                }
              />
            </label>
            <p className="text-xs text-muted-foreground">
              Пустое поле — ставка вида; ноль — явная ставка.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" className={control}>
                Сохранить
              </Button>
              {state.events.some((e) => e.id === event.id) && (
                <Button
                  type="button"
                  variant="outline"
                  className={control}
                  onClick={onDelete}
                >
                  Удалить
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                className={control}
                onClick={onClose}
              >
                Отмена
              </Button>
            </div>
          </form>
        ) : (
          <>
            <h3 className="font-semibold">Программа</h3>
            <p className="text-sm" data-allow-wrap>
              {event.program || "Программа пока не указана."}
            </p>
            <h3 className="font-semibold">Исполнители</h3>
            <p className="text-sm" data-allow-wrap>
              {event.performers || "Состав пока не указан."}
            </p>
          </>
        )}
        <h3 className="font-semibold">Состав</h3>
        <div className="grid gap-2">
          {event.signups.map((id) => (
            <div className="flex justify-between gap-2 text-sm" key={id}>
              <span>{state.workers.find((w) => w.id === id)?.name}</span>
              <span className="text-muted-foreground">
                {state.workers.find((w) => w.id === id)?.position}
              </span>
            </div>
          ))}
        </div>
        {!event.signups.length && (
          <p className="text-sm text-muted-foreground">
            Пока никто не записан.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
function TypeDialog({
  type,
  used,
  onClose,
  onSave,
  onDelete,
}: {
  type: DemoType;
  used: boolean;
  onClose: () => void;
  onSave: (t: DemoType) => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState(type);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogTitle>Вид мероприятия</DialogTitle>
        <DialogDescription>
          В демо ставка и количество мест меняются у всех мероприятий этого
          вида. Ручные ставки сохраняются.
        </DialogDescription>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.name.trim())
              onSave({ ...draft, name: draft.name.trim() });
          }}
        >
          <label className="demo-label">
            Название
            <input
              autoFocus
              className="demo-input"
              required
              maxLength={160}
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          <label className="demo-label">
            Количество мест
            <input
              className="demo-input"
              type="number"
              min={1}
              max={100}
              required
              value={draft.seats}
              onChange={(e) =>
                setDraft({ ...draft, seats: Number(e.target.value) })
              }
            />
          </label>
          <label className="demo-label">
            Ставка, ₽
            <input
              className="demo-input"
              type="number"
              min={0}
              max={1000000}
              required
              value={draft.rate}
              onChange={(e) =>
                setDraft({ ...draft, rate: Number(e.target.value) })
              }
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button className={control}>Сохранить</Button>
            <Button
              className={control}
              type="button"
              variant="outline"
              disabled={used}
              onClick={onDelete}
            >
              Удалить
            </Button>
          </div>
          {used && (
            <p className="text-xs text-muted-foreground">
              Нельзя удалить последний вид или вид, связанный с мероприятиями.
            </p>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
