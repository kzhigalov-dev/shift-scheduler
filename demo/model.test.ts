import { describe, expect, it } from "vitest";
import {
  initialState,
  updateType,
  rateFor,
  toggleSignup,
  readState,
  STORAGE_KEY,
} from "./model";

describe("Изолированное демо", () => {
  it("отбрасывает невозможные даты из хранилища", () => {
    for (const date of ["2026-99-99", "2026-02-30"]) {
      const state = initialState();
      state.events[0].date = date;
      expect(readState(JSON.stringify(state))).toEqual(initialState());
    }
  });
  it("создаёт независимые вымышленные данные", () => {
    const a = initialState();
    a.events[0].title = "Изменено";
    expect(initialState().events[0].title).not.toBe("Изменено");
    expect(initialState().workers.length).toBe(6);
  });
  it("меняет ставку вида, сохраняя ручную ставку мероприятия", () => {
    const state = initialState();
    state.events[0].rate = 3000;
    const typeId = state.events[0].typeId;
    const changed = updateType(state, typeId, "Новое имя", 2400, 5);
    expect(changed.types.find((t) => t.id === typeId)?.name).toBe("Новое имя");
    expect(rateFor(changed, changed.events[0])).toBe(3000);
    const regular = changed.events.find(
      (e) => e.typeId === typeId && e.rate === null,
    )!;
    expect(rateFor(changed, regular)).toBe(2400);
    expect(state.types.find((t) => t.id === typeId)?.rate).not.toBe(2400);
  });
  it("заявка и отмена не дублируют работника и сохраняют остальных", () => {
    const state = initialState();
    const event = state.events.find((e) => !e.signups.includes("worker-1"))!;
    const joined = toggleSignup(state, event.id);
    expect(joined.events.find((e) => e.id === event.id)?.signups).toContain(
      "worker-1",
    );
    expect(toggleSignup(joined, event.id)).toEqual(state);
  });
  it("повреждённое или старое хранилище заменяется исходными данными", () => {
    for (const value of [
      "oops",
      "{}",
      '{"version":0}',
      "null",
      '{"version":1,"events":[]}',
    ]) {
      expect(readState(value)).toEqual(initialState());
    }
    expect(readState(JSON.stringify(initialState()))).toEqual(initialState());
    expect(STORAGE_KEY).toContain("demo");
  });
  it("не принимает данные с неверными ссылками и отрицательными суммами", () => {
    const state = initialState();
    state.events[0].typeId = "missing";
    expect(readState(JSON.stringify(state))).toEqual(initialState());
    const other = initialState();
    other.types[0].rate = -1;
    expect(readState(JSON.stringify(other))).toEqual(initialState());
  });
});
