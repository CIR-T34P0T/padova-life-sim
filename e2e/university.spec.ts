// University basics (M8) in real browsers against the real server, with the
// game's real durations (a lecture takes 2 real minutes, the exam 3). The
// suite's clock starts on a Wednesday at 09:00 (playwright.config.ts), so a
// lecture comes round on the hour and an exam sitting is open all day.
// Desktop: enrol at the notice board beside the hall, attend a lecture and sit
// the exam in the lecture room, see it all in the panel, reload and keep it.
// Phone (Pixel 7 emulation, not a physical device): the notice board's sheet,
// the weekday in the clock chip and the University section of the panel sheet.

import { devices, expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { joinableLecture } from "@padova/shared";
import { continueFromTitle, createCharacter, openObjectMenu, useObject, walkTo } from "./helpers.ts";

const ROOM = "hall/lecture-room";
const COURSE = "city-studies";
const DESK = "lecture-desk-2a";

const openContexts: BrowserContext[] = [];
test.afterEach(async () => {
  await Promise.all(openContexts.splice(0).map((context) => context.close().catch(() => undefined)));
});

async function newPlayer(browser: Browser, name: string, contextOptions = {}): Promise<Page> {
  const context = await browser.newContext(contextOptions);
  openContexts.push(context);
  const page = await context.newPage();
  page.on("pageerror", (error) => console.error(`[${name}] page error:`, error.message));
  await page.goto("/");
  await createCharacter(page, name);
  return page;
}

interface CourseView {
  status: string;
  lecturesAttended: number;
  studySessions: number;
  lastResult: { grade: number; passed: boolean } | null;
}
interface LifeView {
  gameMinute: number;
  course: CourseView | null;
}
const life = (page: Page) => page.evaluate(() => (window as any).__padova.life() as LifeView | null);
const course = async (page: Page) => (await life(page))?.course ?? null;
const interaction = (page: Page) => page.evaluate(() => (window as any).__padova.interaction());
const area = (page: Page) => page.evaluate(() => (window as any).__padova.area as string);

/** The desk's menu entry for an action: its detail text and whether it is greyed out. */
async function deskOption(page: Page, action: "attend" | "exam") {
  const menu = await openObjectMenu(page, DESK);
  const state = (await interaction(page)).menu;
  const index = state.options.indexOf(action === "attend" ? "Attend the lecture" : "Sit the exam");
  expect(index, `desk menu ${JSON.stringify(state)}`).toBeGreaterThanOrEqual(0);
  return { menu, detail: state.details[index] as string, disabled: state.disabled[index] as boolean };
}

async function openPanel(page: Page, touch = false) {
  if (touch) await page.locator("#me-chip").tap();
  else await page.click("#me-chip");
  await expect(page.locator("#character-panel")).toBeVisible();
  const section = page.getByTestId("university");
  // The panel redraws when a life update arrives, so retry if the section is replaced mid-scroll.
  await expect(async () => {
    await section.scrollIntoViewIfNeeded({ timeout: 2_000 });
    await expect(section).toBeInViewport({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  return section;
}

test("desktop: enrol at the notice board, attend a lecture and sit the exam in the lecture room; the panel shows it and a reload keeps it", async ({ browser }) => {
  test.setTimeout(20 * 60_000);
  const page = await newPlayer(browser, "Ada");
  await expect(page.locator("#me-chip")).toContainText("Wed");

  await test.step("the notice board beside the hall offers the course; enrolling works", async () => {
    await walkTo(page, -6, -10);
    await walkTo(page, -17, -15);
    const menu = await openObjectMenu(page, "noticeboard");
    expect(await interaction(page)).toMatchObject({
      menu: { title: "University notice board", subtitle: "Courses: enrol here", options: ["Enrol: Introduction to City Studies"], disabled: [false] },
    });
    await menu.locator('[data-action="enrol"]').click();
    await expect.poll(async () => (await course(page))?.status, { timeout: 20_000 }).toBe("enrolled");
    await expect(page.locator("#toast")).toContainText("You enrolled in Introduction to City Studies");
    const section = await openPanel(page);
    await expect(section).toContainText("Introduction to City Studies");
    await expect(section).toContainText("Mon–Fri, on the hour 09:00–12:00 and 14:00–17:00");
    await expect(page.getByTestId("lectures")).toContainText("0 of 8");
    await expect(page.getByTestId("expected")).toContainText("12/30");
    await page.keyboard.press("Escape");
  });

  await test.step("into the lecture room; a lecture desk offers the lecture (now, or greyed out until the next one)", async () => {
    await walkTo(page, -12.5, -16);
    await useObject(page, "hall-door", "enter");
    await expect.poll(() => area(page), { timeout: 20_000 }).toBe(ROOM);
    await page.waitForTimeout(500);
    // Join only with at least 2 game minutes (12 real seconds) of late entry left.
    const joinableNow = async () => {
      const m = (await life(page))!.gameMinute;
      const lecture = joinableLecture(COURSE, m);
      return lecture !== null && lecture.joinUntil - m >= 2;
    };
    const option = await deskOption(page, "attend");
    if (await joinableNow()) {
      expect(option.detail).toMatch(/^\d\d:00 lecture · join until \d\d:20$/);
      expect(option.disabled).toBe(false);
    } else {
      expect(option.detail).toMatch(/^Next lecture /);
      expect(option.disabled).toBe(true);
      await page.keyboard.press("Escape");
      await expect.poll(joinableNow, { timeout: 12 * 60_000, intervals: [2_000] }).toBe(true);
    }
    await page.keyboard.press("Escape");
  });

  await test.step("attending the whole lecture (2 real minutes) counts it once", async () => {
    const { menu, disabled } = await deskOption(page, "attend");
    expect(disabled).toBe(false);
    await menu.locator('[data-action="attend"]').click();
    await expect.poll(async () => (await interaction(page)).progress, { timeout: 20_000 }).toBe("In the lecture");
    await page.screenshot({ path: "test-results/m8-desktop-lecture.png" });
    await expect.poll(async () => (await course(page))?.lecturesAttended, { timeout: 4 * 60_000, intervals: [2_000] }).toBe(1);
    await expect(page.locator("#toast")).toContainText("Lecture attended: 1 so far");
    // Attending takes as long as late entry (20 game minutes), so by now it has closed.
    const again = await deskOption(page, "attend");
    expect(again.detail).toMatch(/^(Next lecture|Attended · next) /);
    expect(again.disabled).toBe(true);
    await page.keyboard.press("Escape");
  });

  await test.step("the exam sitting is open: the desk shows the expected grade; sitting it (3 real minutes) fails gently", async () => {
    const { menu, detail, disabled } = await deskOption(page, "exam");
    // One lecture, no study, Academic level 0: 12 + 19 × 0.45 / 8 = 13.07.
    expect(detail).toBe("Expected 13/30 · 3 min · open until 19:00");
    expect(disabled).toBe(false);
    await menu.locator('[data-action="exam"]').click();
    await expect.poll(async () => (await interaction(page)).progress, { timeout: 20_000 }).toBe("Sitting the exam");
    await expect.poll(async () => (await course(page))?.lastResult, { timeout: 5 * 60_000, intervals: [2_000] }).toEqual({ grade: 13, passed: false, gameDay: expect.any(Number) });
    await expect(page.locator("#toast")).toContainText("Not passed this time: 13/30");
    expect((await course(page))?.status).toBe("enrolled");
    const again = await deskOption(page, "exam");
    expect(again.detail).toMatch(/^Taken today: 13\/30 · next sitting Sat 09:00 · in about \d+ h$/);
    expect(again.disabled).toBe(true);
    await page.keyboard.press("Escape");
  });

  await test.step("the panel shows attendance and the result; a reload keeps them", async () => {
    let section = await openPanel(page);
    await expect(page.getByTestId("lectures")).toContainText("1 of 8");
    await expect(section).toContainText("Last exam: 13/30, not passed");
    await page.screenshot({ path: "test-results/m8-desktop-panel.png" });
    await page.keyboard.press("Escape");
    await page.reload();
    await continueFromTitle(page, "Ada");
    await expect.poll(() => area(page), { timeout: 20_000 }).toBe(ROOM);
    await expect.poll(async () => (await course(page))?.lecturesAttended, { timeout: 20_000 }).toBe(1);
    section = await openPanel(page);
    await expect(page.getByTestId("lectures")).toContainText("1 of 8");
    await expect(section).toContainText("Last exam: 13/30, not passed");
  });
});

test("mobile: the notice board's sheet has a large Enrol button; the clock chip shows the weekday; the panel sheet shows the course", async ({ browser }) => {
  test.setTimeout(150_000);
  const page = await newPlayer(browser, "Chiara", { ...devices["Pixel 7"] });
  await expect(page.locator("#me-chip")).toContainText("Wed");
  await page.waitForTimeout(500);
  await walkTo(page, -6, -8, true);
  // Short hops: a portrait screen shows little to either side.
  await walkTo(page, -12, -12, true);
  await walkTo(page, -15, -12, true);
  await walkTo(page, -17, -13.5, true);
  const sheet = await openObjectMenu(page, "noticeboard", true);
  const enrol = sheet.locator('[data-action="enrol"]');
  await expect(enrol).toContainText("Enrol: Introduction to City Studies");
  expect((await enrol.boundingBox())!.height).toBeGreaterThanOrEqual(48);
  await page.screenshot({ path: "test-results/m8-phone-noticeboard.png" });
  await enrol.tap();
  await expect.poll(async () => (await course(page))?.status, { timeout: 20_000 }).toBe("enrolled");
  const section = await openPanel(page, true);
  await expect(page.getByTestId("lectures")).toContainText("0 of 8");
  await expect(page.getByTestId("lecture")).toContainText(/lecture/i);
  await expect(section).toContainText("Wed and Sat, 09:00–19:00");
  await page.screenshot({ path: "test-results/m8-phone-panel.png" });
});
