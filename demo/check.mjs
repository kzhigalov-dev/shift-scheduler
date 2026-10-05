import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const base = process.env.DEMO_URL ?? "http://localhost:3200/shift-scheduler/";
const browser = await chromium.launch({ headless: true });
await mkdir(".superpowers/demo", { recursive: true });
let checked = 0;
try {
  for (const colorScheme of ["light", "dark"]) {
    for (const width of [360, 390, 768, 1024, 1440]) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        colorScheme,
      });
      const page = await context.newPage();
      const errors = [];
      const external = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("request", (r) => {
        if (new URL(r.url()).origin !== new URL(base).origin)
          external.push(r.url());
      });
      await page.goto(base);
      await page.getByRole("heading", { name: "Месяц", exact: true }).waitFor();
      async function check(name) {
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
          true,
          `${width} ${colorScheme} ${name}: horizontal overflow`,
        );
        assert.deepEqual(errors, [], `${name}: runtime errors`);
        assert.deepEqual(external, [], `${name}: external requests`);
        await page.screenshot({
          path: `.superpowers/demo/${width}-${colorScheme}-${name}.png`,
          fullPage: true,
          animations: "disabled",
        });
        checked++;
      }
      await check("month");
      for (const name of ["Работники", "Виды мероприятий", "Оплата"]) {
        await page
          .getByRole("navigation", { name: "Основная навигация" })
          .getByRole("button", { name, exact: true })
          .click();
        await check(name);
      }
      await page
        .getByRole("button", { name: "Редактировать", exact: true })
        .count();
      await page.getByRole("button", { name: "Работник", exact: true }).click();
      await check("shifts");
      for (const name of ["Свободные места", "Заработок", "Памятка"]) {
        await page
          .getByRole("navigation", { name: "Основная навигация" })
          .getByRole("button", { name, exact: true })
          .click();
        await check(name);
      }
      await page
        .getByRole("button", { name: "Уведомления", exact: true })
        .click();
      await page.getByRole("dialog").waitFor();
      await check("notifications");
      await page.getByRole("button", { name: "Закрыть", exact: true }).click();
      await page.getByRole("button", { name: "Менеджер", exact: true }).click();
      await page
        .getByRole("button", { name: "Добавить мероприятие", exact: true })
        .click();
      await check("event-dialog");
      await page
        .getByLabel("Название", { exact: true })
        .fill("Демонстрационный концерт");
      await page.getByLabel("Отдельная ставка, ₽").fill("2700");
      await page
        .getByRole("button", { name: "Сохранить", exact: true })
        .click();
      await page.reload();
      await page.getByRole("heading", { name: "Месяц", exact: true }).waitFor();
      assert(
        await page
          .getByText("Демонстрационный концерт", { exact: true })
          .filter({ visible: true })
          .first()
          .isVisible(),
      );
      await page
        .getByRole("navigation")
        .getByRole("button", { name: "Виды мероприятий", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Редактировать", exact: true })
        .first()
        .click();
      await check("type-dialog");
      await page.getByLabel("Название", { exact: true }).fill("Органный вечер");
      await page.getByLabel("Ставка, ₽", { exact: true }).fill("2500");
      await page
        .getByRole("button", { name: "Сохранить", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "Органный вечер", exact: true })
        .waitFor();
      await page
        .getByRole("button", { name: "Сбросить демо", exact: true })
        .click();
      await check("reset-dialog");
      await page.getByRole("button", { name: "Сбросить", exact: true }).click();
      await page
        .getByRole("heading", { name: "Органный вторник", exact: true })
        .waitFor();
      await page.getByRole("button", { name: "Работник", exact: true }).click();
      await page
        .getByRole("navigation")
        .getByRole("button", { name: "Свободные места", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Записаться", exact: true })
        .first()
        .click();
      const storage = await page.evaluate(() =>
        JSON.parse(localStorage.getItem("shift-scheduler-demo-v1")),
      );
      assert.equal(
        storage.events.filter(
          (e) => e.date.startsWith("2026-10") && e.signups.includes("worker-1"),
        ).length,
        5,
      );
      await page
        .getByRole("button", { name: "Отменить запись", exact: true })
        .nth(1)
        .click();
      await context.close();
    }
  }
  console.log(
    `✓ ${checked} экранов и диалогов; создание, сохранение, ставка, сброс и запись; без внешних запросов`,
  );
} finally {
  await browser.close();
}
