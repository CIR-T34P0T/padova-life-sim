// M7 first job in real browsers against the real server, with the game's
// default durations (a shift is 90 real seconds): ask about work at the café
// counter, work a shift behind it while another player watches, get the wage,
// keep job and wage after a reload, quit from the character panel. Also the
// phone layout of the menu sheet and the panel's Work section.
// The phone is Chromium mobile emulation (Pixel 7), not a physical device.
// The e2e server's clock is shifted so the café is open (playwright.config.ts).

import { devices, expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { continueFromTitle, createCharacter } from "./helpers.ts";

interface LifeView {
  gameMinute: number;
  needs: Record<string, number>;
  skills: Record<string, { xp: number; level: number }>;
  money: { balanceCents: number; recent: { id: string; category: string; description: string; amountCents: number }[] };
  job: { jobId: string; shiftsToday: number } | null;
}

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
  await expect.poll(() => life(page)).not.toBeNull();
  return page;
}

const life = (page: Page): Promise<LifeView | null> => page.evaluate(() => (window as any).__padova.life());
const mustLife = async (page: Page): Promise<LifeView> => (await life(page))!;
const interaction = (page: Page) => page.evaluate(() => (window as any).__padova.interaction());
const players = (page: Page) =>
  page.evaluate(() => (window as any).__padova.players() as { id: string; name: string; x: number; z: number; moving: boolean; activity: string }[]);
const selfId = (page: Page) => page.evaluate(() => (window as any).__padova.selfId as string);
const me = async (page: Page) => {
  const id = await selfId(page);
  return (await players(page)).find((p) => p.id === id)!;
};
const reachesGameView = (page: Page, x: number, y: number) =>
  page.evaluate(([sx, sy]) => document.elementFromPoint(sx, sy)?.tagName === "CANVAS", [x, y] as const);

/** Clicks (or taps) the ground at a world point and waits until the character stops there. */
async function walkTo(page: Page, x: number, z: number, touch = false) {
  const point = await page.evaluate(([px, pz]) => (window as any).__padova.worldToScreen(px, pz), [x, z] as const);
  expect(await page.evaluate(([sx, sy]) => (window as any).__padova.pickAt(sx, sy), [point.x, point.y] as const)).toMatchObject({ kind: "ground" });
  expect(await reachesGameView(page, point.x, point.y), `ground (${x}, ${z}) should not be covered by UI`).toBe(true);
  if (touch) await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
  await expect.poll(async () => {
    const self = await me(page);
    return Math.hypot(self.x - x, self.z - z) < 0.5 && !self.moving;
  }, { timeout: 20_000 }).toBe(true);
}

/** Screen point for the café counter once the camera has stopped gliding; checked to pick the counter. */
async function counterPoint(page: Page) {
  const read = () => page.evaluate(() => (window as any).__padova.targetScreenPoint("object", "cafe-counter"));
  let point = await read();
  await expect.poll(async () => {
    const next = await read();
    const still = Math.hypot(next.x - point.x, next.y - point.y) < 1;
    point = next;
    return still;
  }, { timeout: 10_000, intervals: [250] }).toBe(true);
  expect(point?.visible, "the café counter should be on screen").toBe(true);
  const aim = { x: point.x, y: point.y + 4 };
  expect(await page.evaluate(([x, y]) => (window as any).__padova.pickAt(x, y), [aim.x, aim.y] as const)).toMatchObject({ kind: "object", id: "cafe-counter" });
  expect(await reachesGameView(page, aim.x, aim.y), "the café counter should not be covered by UI").toBe(true);
  return aim;
}

test("desktop: ask about work, work a shift behind the counter, get the wage, keep it after a reload, quit", async ({ browser }) => {
  test.setTimeout(300_000);
  const page = await newPlayer(browser, "Marta");
  const watcher = await newPlayer(browser, "Watcher");
  const martaId = await selfId(page);
  expect((await mustLife(page)).job).toBeNull();

  await test.step("the counter offers work with its wage; choosing it walks over and hires at once", async () => {
    await walkTo(page, 5, 11);
    await walkTo(page, 6.5, 11.5);
    const counter = await counterPoint(page);
    await page.mouse.click(counter.x, counter.y);
    expect(await interaction(page)).toMatchObject({
      menu: { title: "Café counter", options: ["Espresso", "Cornetto", "Panino", "Ask about work"], details: ["€1.50", "€1.80", "€4.50", "€6.00 a shift"] },
    });
    await page.click('#action-menu [data-action="ask_work"]');
    await expect.poll(async () => (await mustLife(page)).job, { timeout: 20_000 }).toEqual({ jobId: "cafe", shiftsToday: 0 });
    await expect(page.locator("#toast")).toContainText(/You got the job: Café assistant/);
  });

  let before!: LifeView;
  await test.step("an employee is offered a shift; working happens at a staff spot behind the counter and others see it", async () => {
    await page.waitForTimeout(600);
    const counter = await counterPoint(page);
    await page.mouse.click(counter.x, counter.y);
    const menu = (await interaction(page)).menu;
    expect(menu).toMatchObject({ options: ["Espresso", "Cornetto", "Panino", "Work a shift"], details: ["€1.50", "€1.80", "€4.50", "€6.00 · 90 s"], disabled: [false, false, false, false] });
    expect(menu.subtitle).toContain("you work here");
    before = await mustLife(page);
    await page.click('#action-menu [data-action="work"]');
    await expect.poll(async () => (await me(page)).activity, { timeout: 20_000 }).toBe("working");
    const self = await me(page);
    expect(self.z).toBeGreaterThan(10.4); // south of the counter: the staff side
    await expect(page.locator("#action-progress")).toContainText("Working a shift");
    await expect.poll(async () => (await players(watcher)).find((p) => p.id === martaId)?.activity, { timeout: 10_000 }).toBe("working");
    await page.screenshot({ path: "test-results/m7-desktop-working.png" });
  });

  await test.step("after 90 seconds the shift completes and pays €6.00 once, as a wage", async () => {
    await expect.poll(async () => (await me(page)).activity, { timeout: 120_000, intervals: [500] }).toBe("idle");
    await expect(page.locator("#toast")).toContainText(/Shift done: \+€6\.00 wage/);
    await expect.poll(async () => (await mustLife(page)).job?.shiftsToday, { timeout: 10_000 }).toBe(1);
    const after = await mustLife(page);
    const wages = after.money.recent.filter((entry) => entry.category === "wage");
    expect(wages).toEqual([expect.objectContaining({ description: "Wage: Café assistant", amountCents: 600 })]);
    // Only the wage was added (and a daily allowance if the game day changed meanwhile).
    const seen = new Set(before.money.recent.map((entry) => entry.id));
    const newAllowances = after.money.recent.filter((entry) => entry.category === "allowance" && !seen.has(entry.id)).length;
    expect(after.money.balanceCents - before.money.balanceCents).toBe(600 + 750 * newAllowances);
    expect(after.skills.communication!.xp).toBeGreaterThan(before.skills.communication!.xp);
    expect(after.needs.energy).toBeLessThan(before.needs.energy);
  });

  await test.step("the character panel shows the job, the wage, today's shifts and the opening hours", async () => {
    await page.locator("#me-chip").click();
    const panel = page.locator("#character-panel");
    await expect(panel).toBeVisible();
    await expect(page.getByTestId("work")).toContainText("Café kiosk · Café assistant");
    await expect(page.getByTestId("work")).toContainText("€6.00 per completed shift");
    await expect(page.getByTestId("work")).toContainText("Barista €8.00 at Communication Lv 2");
    await expect(page.getByTestId("shifts")).toContainText("Shifts today 1 of 4 · Open now, until 23:00");
    await expect(panel).toContainText("+€6.00");
    await expect(panel).toContainText("Wage: Café assistant");
    // The panel redraws when a life update arrives (up to twice a second): retry if the section is replaced mid-scroll.
    await expect(async () => {
      await page.getByTestId("work").scrollIntoViewIfNeeded({ timeout: 2_000 });
      await expect(page.getByTestId("work")).toBeInViewport({ timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    await page.screenshot({ path: "test-results/m7-desktop-panel.png" });
    await page.keyboard.press("Escape");
  });

  await test.step("reload: the job, today's shift and the wage come back from the server", async () => {
    await page.reload();
    await continueFromTitle(page, "Marta");
    await expect.poll(() => life(page)).not.toBeNull();
    const reloaded = await mustLife(page);
    expect(reloaded.job).toEqual({ jobId: "cafe", shiftsToday: 1 });
    expect(reloaded.money.recent.some((entry) => entry.category === "wage" && entry.amountCents === 600)).toBe(true);
  });

  await test.step("Quit job in the panel ends the job; the counter offers work again", async () => {
    await page.waitForTimeout(400);
    await page.locator("#me-chip").click();
    await expect(page.locator("#character-panel")).toBeVisible();
    await page.locator('[data-action="quit-job"]').click();
    await expect.poll(async () => (await mustLife(page)).job, { timeout: 10_000 }).toBeNull();
    await expect(page.getByTestId("work")).toContainText("No job yet");
    await expect(page.locator("#toast")).toContainText("You quit your job at the café.");
    // The wage stays in the history.
    expect((await mustLife(page)).money.recent.some((entry) => entry.category === "wage")).toBe(true);
    await page.keyboard.press("Escape");
  });

});

test("mobile: the café sheet offers work with large buttons, and the Work section fits the panel sheet", async ({ browser }) => {
  test.setTimeout(150_000);
  const page = await newPlayer(browser, "Chiara", { ...devices["Pixel 7"] });
  await page.waitForTimeout(500);

  await test.step("tap the counter: the sheet lists the menu and Ask about work; hired after tapping it", async () => {
    await walkTo(page, 4, 12, true);
    await walkTo(page, 7, 12, true);
    const counter = await counterPoint(page);
    await page.touchscreen.tap(counter.x, counter.y);
    const sheet = page.locator("#action-sheet");
    await expect(sheet).toBeVisible();
    expect(await interaction(page)).toMatchObject({ menu: { kind: "sheet", options: ["Espresso", "Cornetto", "Panino", "Ask about work"] } });
    const button = sheet.locator('[data-action="ask_work"]');
    const box = (await button.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(48);
    await expect(button).toContainText("€6.00 a shift");
    await page.screenshot({ path: "test-results/m7-phone-sheet.png" });
    await button.tap();
    await expect.poll(async () => (await mustLife(page)).job, { timeout: 20_000 }).toEqual({ jobId: "cafe", shiftsToday: 0 });
  });

  await test.step("the panel sheet scrolls to the Work section; Quit job is a full-size touch target", async () => {
    await page.locator("#me-chip").tap();
    await expect(page.locator("#character-panel")).toBeVisible();
    // The panel redraws when a life update arrives, so retry if the section is replaced mid-scroll.
    await expect(async () => {
      await page.getByTestId("shifts").scrollIntoViewIfNeeded({ timeout: 2_000 });
      await expect(page.getByTestId("shifts")).toBeInViewport({ timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    await expect(page.getByTestId("shifts")).toContainText("Shifts today 0 of 4");
    const quit = page.locator('[data-action="quit-job"]');
    await expect(async () => {
      await quit.scrollIntoViewIfNeeded({ timeout: 2_000 });
      const box = (await quit.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
    }).toPass({ timeout: 15_000 });
    const viewport = page.viewportSize()!;
    const panel = (await page.locator("#character-panel").boundingBox())!;
    expect(panel.height).toBeLessThan(viewport.height * 0.5);
    await page.screenshot({ path: "test-results/m7-phone-panel.png" });
  });
});
