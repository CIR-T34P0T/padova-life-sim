// M5 life-simulation loop in a real browser against the real server, with the
// game's default durations: open the character panel, walk to the café, buy a
// panino (server transaction), eat it, study at a desk, see needs/skills/money
// change in the panel, then reload and get the same progress back.
// Also: the panel's footprint on desktop and as a phone bottom sheet.
// The phone is Chromium mobile emulation (Pixel 7), not a physical device.

import { devices, expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { continueFromTitle, createCharacter } from "./helpers.ts";

interface LifeView {
  gameMinute: number;
  needs: Record<"hunger" | "energy" | "hygiene" | "social" | "fun", number>;
  skills: Record<string, { xp: number; level: number }>;
  traits: string[];
  money: { balanceCents: number; recent: { category: string; description: string; amountCents: number; balanceAfterCents: number }[] };
}

const openContexts: BrowserContext[] = [];
test.afterEach(async () => {
  await Promise.all(openContexts.splice(0).map((context) => context.close().catch(() => undefined)));
});

async function newPlayer(browser: Browser, name: string, traits: string[], contextOptions = {}): Promise<Page> {
  const context = await browser.newContext(contextOptions);
  openContexts.push(context);
  const page = await context.newPage();
  page.on("pageerror", (error) => console.error(`[${name}] page error:`, error.message));
  await page.goto("/");
  await createCharacter(page, name, {}, traits);
  await expect.poll(() => life(page)).not.toBeNull();
  return page;
}

const life = (page: Page): Promise<LifeView | null> => page.evaluate(() => (window as any).__padova.life());
const mustLife = async (page: Page): Promise<LifeView> => (await life(page))!;
const interaction = (page: Page) => page.evaluate(() => (window as any).__padova.interaction());
const panel = (page: Page): Promise<{ open: boolean; mode: string; text: string }> => page.evaluate(() => (window as any).__padova.characterPanel());
const me = (page: Page) =>
  page.evaluate(() => {
    const game = (window as any).__padova;
    return game.players().find((p: { id: string }) => p.id === game.selfId) as { id: string; x: number; z: number; moving: boolean; activity: string };
  });

/** True when a click at this screen point reaches the 3D view (not the panel or another overlay). */
const reachesGameView = (page: Page, x: number, y: number) =>
  page.evaluate(([sx, sy]) => document.elementFromPoint(sx, sy)?.tagName === "CANVAS", [x, y] as const);

/** Clicks the ground at a world point (checked to be ground) and waits until the character stops there. */
async function walkTo(page: Page, x: number, z: number) {
  const point = await page.evaluate(([px, pz]) => (window as any).__padova.worldToScreen(px, pz), [x, z] as const);
  expect(await page.evaluate(([sx, sy]) => (window as any).__padova.pickAt(sx, sy), [point.x, point.y] as const)).toMatchObject({ kind: "ground" });
  expect(await reachesGameView(page, point.x, point.y), `ground (${x}, ${z}) should not be covered by UI`).toBe(true);
  await page.mouse.click(point.x, point.y);
  await expect.poll(async () => {
    const self = await me(page);
    return Math.hypot(self.x - x, self.z - z) < 0.5 && !self.moving;
  }, { timeout: 20_000 }).toBe(true);
  await page.waitForTimeout(400); // camera follows
}

/**
 * Screen point for an object, checked to be on screen and to pick that object.
 * Waits until the point stops moving: the camera glides after the character,
 * and on a slow, software-rendered machine 400 ms is not always enough (the
 * café counter was once measured mid-glide, under the panel's edge).
 */
async function objectPoint(page: Page, id: string) {
  const read = () => page.evaluate((i) => (window as any).__padova.targetScreenPoint("object", i), id);
  let point = await read();
  await expect.poll(async () => {
    const next = await read();
    const still = Math.hypot(next.x - point.x, next.y - point.y) < 1;
    point = next;
    return still;
  }, { timeout: 10_000, intervals: [250] }).toBe(true);
  expect(point?.visible, `${id} should be on screen`).toBe(true);
  const aim = { x: point.x, y: point.y + 4 };
  expect(await page.evaluate(([x, y]) => (window as any).__padova.pickAt(x, y), [aim.x, aim.y] as const)).toMatchObject({ kind: "object", id });
  expect(await reachesGameView(page, aim.x, aim.y), `${id} should not be covered by UI`).toBe(true);
  return aim;
}

/** Clicks yourself and picks "Character" from your own menu. */
async function openPanelFromSelf(page: Page) {
  const self = await page.evaluate(() => {
    const game = (window as any).__padova;
    return game.targetScreenPoint("player", game.selfId);
  });
  expect(await page.evaluate(([x, y]) => (window as any).__padova.pickAt(x, y), [self.x, self.y] as const)).toEqual({ kind: "self" });
  await page.mouse.click(self.x, self.y);
  expect((await interaction(page)).menu.options).toContain("Character");
  await page.click('#action-menu [data-action="character"]');
  await expect(page.locator("#character-panel")).toBeVisible();
}

test("desktop: café → eat → study, all visible in the character panel, and kept after a reload", async ({ browser }) => {
  test.setTimeout(180_000);
  const page = await newPlayer(browser, "Giulia", ["organised"]);
  const start = await mustLife(page);
  expect(start.traits).toEqual(["organised"]);

  await test.step("clicking yourself → Character opens a compact panel with needs, mood, skills, money and current action", async () => {
    await page.waitForTimeout(400);
    await openPanelFromSelf(page);
    const view = await panel(page);
    expect(view).toMatchObject({ open: true, mode: "side" });
    for (const label of ["Organised", "Mood", "Now", "Idle", "Hunger", "Energy", "Hygiene", "Social", "Fun", "Academic · Lv 0", "Creativity", "Money"]) {
      expect(view.text.toLowerCase()).toContain(label.toLowerCase()); // section titles are upper-cased by CSS
    }
    await expect(page.getByTestId("balance")).toHaveText(`€${(start.money.balanceCents / 100).toFixed(2)}`);
    // Compact: well under a third of the screen width; the 3D view stays visible.
    const box = (await page.locator("#character-panel").boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(box.width).toBeLessThanOrEqual(viewport.width * 0.3);
    await expect(page.locator("#me-chip")).toBeVisible();
    await page.screenshot({ path: "test-results/m5-desktop-panel.png" });
  });

  let afterMeal!: LifeView;
  await test.step("walk to the café and buy a panino: the server charges €4.50 once", async () => {
    // The panel stays open while playing. The café counter is east of the spawn point.
    // Stop 2.5 m from it, in two steps (the second point is under the panel as
    // seen from the spawn point): from 4 m away the counter sat a few pixels from
    // the panel's left edge, and where the walk ended (within 0.5 m) decided
    // whether it was covered.
    await walkTo(page, 5, 11);
    await walkTo(page, 6.5, 11.5);
    const counter = await objectPoint(page, "cafe-counter");
    await page.mouse.click(counter.x, counter.y);
    const menu = (await interaction(page)).menu;
    // Since M7 the counter also offers work to anyone without a job (e2e/work.spec.ts).
    expect(menu).toMatchObject({ title: "Café counter", options: ["Espresso", "Cornetto", "Panino", "Ask about work"], details: ["€1.50", "€1.80", "€4.50", "€6.00 a shift"] });
    const before = await mustLife(page);
    await page.click('#action-menu [data-action="buy:panino"]');
    await expect(page.locator("#action-progress")).toContainText(/panino/i);
    await expect.poll(async () => (await me(page)).activity, { timeout: 20_000 }).toBe("eating");
    await expect.poll(async () => (await mustLife(page)).money.balanceCents).toBe(before.money.balanceCents - 450);
    const purchase = (await mustLife(page)).money.recent[0]!;
    expect(purchase).toMatchObject({ category: "purchase", description: "Panino", amountCents: 450, balanceAfterCents: before.money.balanceCents - 450 });
    await expect(page.locator("#character-panel")).toContainText("Eating a panino");
    await expect(page.getByTestId("balance")).toHaveText(`€${((before.money.balanceCents - 450) / 100).toFixed(2)}`);
    await expect(page.locator("#character-panel")).toContainText("−€4.50");
    await page.screenshot({ path: "test-results/m5-desktop-eating.png" });
    // Eating takes 15 s with default tuning; hunger fills while eating.
    await expect.poll(async () => (await me(page)).activity, { timeout: 30_000 }).toBe("idle");
    afterMeal = await mustLife(page);
    expect(afterMeal.needs.hunger).toBeGreaterThan(before.needs.hunger + 15);
    expect(afterMeal.money.balanceCents).toBe(before.money.balanceCents - 450);
    // Exactly one purchase was recorded.
    expect(afterMeal.money.recent.filter((entry) => entry.category === "purchase")).toHaveLength(1);
    await expect(page.getByTestId("need-hunger")).toContainText(String(Math.round(afterMeal.needs.hunger)));
  });

  let afterStudy!: LifeView;
  await test.step("walk to a study desk and study: academic skill goes up", async () => {
    await walkTo(page, 2, 3);
    await walkTo(page, -9, -9);
    const desk = await objectPoint(page, "desk-2");
    await page.mouse.click(desk.x, desk.y);
    expect(await interaction(page)).toMatchObject({ menu: { title: "Study desk", options: ["Study", "Sit"] } });
    await page.click('#action-menu [data-action="study"]');
    await expect.poll(async () => (await me(page)).activity, { timeout: 20_000 }).toBe("studying");
    await expect(page.locator("#character-panel")).toContainText("Studying");
    // Skill XP is added gradually while studying (20 s with default tuning).
    await expect.poll(async () => (await mustLife(page)).skills.academic!.xp, { timeout: 10_000 }).toBeGreaterThan(0);
    await expect.poll(async () => (await me(page)).activity, { timeout: 30_000 }).not.toBe("studying");
    afterStudy = await mustLife(page);
    // Base 20 XP, ×1.2 for Organised, ×mood (0.75–1.25).
    expect(afterStudy.skills.academic!.xp).toBeGreaterThanOrEqual(15);
    expect(afterStudy.skills.academic!.xp).toBeLessThanOrEqual(31);
    expect(afterStudy.needs.energy).toBeLessThan(afterMeal.needs.energy);
    await expect(page.getByTestId("skill-academic")).toContainText(`${Math.floor(afterStudy.skills.academic!.xp)}/100 XP`);
    await page.screenshot({ path: "test-results/m5-desktop-studied.png" });
  });

  await test.step("reload: needs, skills, money and purchase history come back from the server", async () => {
    await page.reload();
    await continueFromTitle(page, "Giulia");
    await expect.poll(() => life(page)).not.toBeNull();
    const reloaded = await mustLife(page);
    expect(reloaded.traits).toEqual(["organised"]);
    expect(reloaded.skills.academic!.xp).toBeCloseTo(afterStudy.skills.academic!.xp, 5);
    // Same balance, unless the game day changed during the test (one more daily allowance).
    expect([afterStudy.money.balanceCents, afterStudy.money.balanceCents + 750]).toContain(reloaded.money.balanceCents);
    expect(reloaded.money.recent.some((entry) => entry.category === "purchase" && entry.description === "Panino")).toBe(true);
    // Needs keep their values (a reload is seconds of offline time).
    expect(Math.abs(reloaded.needs.hunger - afterStudy.needs.hunger)).toBeLessThan(3);
    // The panel shows it again.
    await page.waitForTimeout(400);
    await openPanelFromSelf(page);
    await expect(page.getByTestId("skill-academic")).toContainText(`${Math.floor(reloaded.skills.academic!.xp)}/100 XP`);
    await expect(page.locator("#character-panel")).toContainText("Panino");
    await page.keyboard.press("Escape");
    await expect(page.locator("#character-panel")).toBeHidden();
  });
});

test("mobile: the character panel is a bottom sheet under half the screen", async ({ browser }) => {
  const page = await newPlayer(browser, "Chiara", ["sociable", "creative"], { ...devices["Pixel 7"] });
  await page.waitForTimeout(500);

  await test.step("the HUD chip and the connection pill do not overlap", async () => {
    const chip = (await page.locator("#me-chip").boundingBox())!;
    const status = (await page.locator("#status").boundingBox())!;
    const players = (await page.locator("#players").boundingBox())!;
    for (const other of [status, players]) {
      const overlap = chip.x < other.x + other.width && other.x < chip.x + chip.width && chip.y < other.y + other.height && other.y < chip.y + chip.height;
      expect(overlap).toBe(false);
    }
    expect(chip.height).toBeGreaterThanOrEqual(44);
  });

  await test.step("tapping yourself → Character opens the sheet, and hides the joystick in portrait", async () => {
    const self = await page.evaluate(() => {
      const game = (window as any).__padova;
      return game.targetScreenPoint("player", game.selfId);
    });
    await page.touchscreen.tap(self.x, self.y);
    expect(await interaction(page)).toMatchObject({ menu: { kind: "sheet", options: ["Character", "Edit look"] } });
    await page.locator('#action-sheet [data-action="character"]').tap();
    await expect(page.locator("#action-sheet")).toBeHidden();
    await expect(page.locator("#character-panel")).toBeVisible();
    expect(await panel(page)).toMatchObject({ open: true, mode: "sheet" });
    const viewport = page.viewportSize()!;
    // Measured once the slide-in animation has finished: docked to the bottom edge.
    await expect.poll(async () => {
      const b = (await page.locator("#character-panel").boundingBox())!;
      return Math.round(b.y + b.height);
    }).toBe(viewport.height);
    const box = (await page.locator("#character-panel").boundingBox())!;
    expect(box.height).toBeLessThan(viewport.height * 0.5);
    await expect(page.locator("#joystick")).toBeHidden();
    await expect(page.locator("#character-panel")).toContainText("Sociable");
    await expect(page.locator("#character-panel")).toContainText("Creative");
    // The sheet scrolls to reach the money section. The panel redraws that
    // section when a `life` update arrives (up to twice a second), so retry if
    // the element is replaced mid-scroll.
    await expect(async () => {
      await page.getByTestId("balance").scrollIntoViewIfNeeded({ timeout: 2_000 });
      await expect(page.getByTestId("balance")).toBeInViewport({ timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    await page.screenshot({ path: "test-results/m5-phone-panel.png" });
  });

  await test.step("closing restores the joystick; the HUD chip toggles the panel too", async () => {
    await page.locator("#character-panel .cp-close").tap();
    await expect(page.locator("#character-panel")).toBeHidden();
    await expect(page.locator("#joystick")).toBeVisible();
    await page.locator("#me-chip").tap();
    await expect(page.locator("#character-panel")).toBeVisible();
    await page.locator("#me-chip").tap();
    await expect(page.locator("#character-panel")).toBeHidden();
  });
});
