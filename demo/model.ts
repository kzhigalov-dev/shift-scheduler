export type DemoType = {
  id: string;
  name: string;
  rate: number;
  seats: number;
};
export type DemoEvent = {
  id: string;
  date: string;
  time: string;
  title: string;
  program: string;
  performers: string;
  typeId: string;
  rate: number | null;
  signups: string[];
};
export type DemoWorker = { id: string; name: string; position: string };
export type DemoState = {
  version: 1;
  types: DemoType[];
  events: DemoEvent[];
  workers: DemoWorker[];
};
export const STORAGE_KEY = "shift-scheduler-demo-v1";
export const DEMO_MONTH = "2026-10";
export function initialState(): DemoState {
  const types = [
    { id: "organ", name: "Органный вторник", rate: 2000, seats: 6 },
    { id: "chamber", name: "Камерный концерт", rate: 1500, seats: 4 },
    { id: "evening", name: "Вечерний концерт", rate: 1800, seats: 8 },
    { id: "tour", name: "Экскурсия", rate: 1500, seats: 3 },
    { id: "lecture", name: "Лекция", rate: 1500, seats: 4 },
    { id: "special", name: "Особое мероприятие", rate: 2200, seats: 6 },
  ];
  const workers = [
    "Алексей Примеров",
    "Мария Демонова",
    "Иван Образцов",
    "Елена Тестова",
    "Павел Макетов",
    "Ольга Примерова",
  ].map((name, i) => ({
    id: `worker-${i + 1}`,
    name,
    position: i < 2 ? "Зал" : i < 4 ? "Вход" : "Гардероб",
  }));
  const titles = [
    "Бах при свечах",
    "Музыка барокко",
    "Вечер камерной музыки",
    "Знакомство с пространством",
    "История органа",
    "Музыка под сводами",
  ];
  const events: DemoEvent[] = [];
  for (const month of ["2026-09", DEMO_MONTH, "2026-11"]) {
    [6, 9, 10, 11, 13, 16, 20, 23, 24, 25, 27, 30].forEach((day, i) => {
      const type = types[i % types.length];
      events.push({
        id: `${month}-${day}`,
        date: `${month}-${String(day).padStart(2, "0")}`,
        time: i % 3 === 0 ? "18:00" : "19:00",
        title: titles[i % titles.length],
        program:
          "Демонстрационная программа: произведения И. С. Баха, А. Вивальди и В. А. Моцарта.",
        performers: "Анна Примерова — орган; Михаил Образцов — скрипка",
        typeId: type.id,
        rate: null,
        signups:
          i % 3 === 0
            ? ["worker-1", "worker-2", "worker-3"]
            : ["worker-2", "worker-4"],
      });
    });
  }
  return { version: 1, types, workers, events };
}
export function rateFor(state: DemoState, event: DemoEvent): number {
  return (
    event.rate ?? state.types.find((t) => t.id === event.typeId)?.rate ?? 0
  );
}
export function updateType(
  state: DemoState,
  id: string,
  name: string,
  rate: number,
  seats: number,
): DemoState {
  return {
    ...state,
    types: state.types.map((t) =>
      t.id === id ? { ...t, name, rate, seats } : t,
    ),
  };
}
export function toggleSignup(state: DemoState, id: string): DemoState {
  return {
    ...state,
    events: state.events.map((e) =>
      e.id === id
        ? {
            ...e,
            signups: e.signups.includes("worker-1")
              ? e.signups.filter((w) => w !== "worker-1")
              : [...e.signups, "worker-1"],
          }
        : e,
    ),
  };
}
const short = (value: string) =>
  typeof value === "string" && value.length > 0 && value.length < 200;
const validDate = (value: string) =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
const amount = (value: number) =>
  Number.isSafeInteger(value) && value >= 0 && value <= 1000000;
export function readState(raw: string | null): DemoState {
  try {
    if (!raw || raw.length > 250000) return initialState();
    const s: DemoState = JSON.parse(raw);
    if (
      !s ||
      s.version !== 1 ||
      !Array.isArray(s.types) ||
      !Array.isArray(s.events) ||
      !Array.isArray(s.workers)
    )
      return initialState();
    if (
      !s.types.length ||
      s.types.length > 30 ||
      s.events.length > 500 ||
      s.workers.length !== 6
    )
      return initialState();
    if (
      !s.types.every(
        (t) =>
          t &&
          short(t.id) &&
          short(t.name) &&
          amount(t.rate) &&
          Number.isInteger(t.seats) &&
          t.seats >= 1 &&
          t.seats <= 100,
      )
    )
      return initialState();
    if (
      !s.workers.every(
        (w) => w && short(w.id) && short(w.name) && short(w.position),
      )
    )
      return initialState();
    if (
      !s.events.every(
        (e) =>
          e &&
          short(e.id) &&
          short(e.title) &&
          validDate(e.date) &&
          typeof e.time === "string" &&
          /^([01]\d|2[0-3]):[0-5]\d$/.test(e.time) &&
          typeof e.program === "string" &&
          e.program.length <= 2000 &&
          typeof e.performers === "string" &&
          e.performers.length <= 500 &&
          s.types.some((t) => t.id === e.typeId) &&
          (e.rate === null || amount(e.rate)) &&
          Array.isArray(e.signups) &&
          new Set(e.signups).size === e.signups.length &&
          e.signups.every((id) => s.workers.some((w) => w.id === id)),
      )
    )
      return initialState();
    if (
      new Set(s.events.map((e) => e.id)).size !== s.events.length ||
      new Set(s.types.map((t) => t.id)).size !== s.types.length ||
      new Set(s.workers.map((w) => w.id)).size !== s.workers.length
    )
      return initialState();
    return s;
  } catch {
    return initialState();
  }
}
