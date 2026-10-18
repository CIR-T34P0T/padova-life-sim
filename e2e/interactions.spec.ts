// M3 interaction flows in real browsers against the real server: selecting
// objects and players, desktop radial menu, mobile action sheet, sit/stand,
// greeting, cancellation, and gestures that must NOT select anything.
// The phone is Chromium mobile emulation (Pixel 7), not a physical device.

import { devices, expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { joinAs as openPlayer } from "./helpers.ts";

interface DebugPlayer {
  id: string;
  name: string;
  activity: string;
  seatId: string;
  targetId: string;
}

// Contexts are closed after every test, even when it fails, so players never leak into the next test.
const openContexts: BrowserContext[] = [];
test.afterEach(async () => {
  await Promise.all(openContexts.splice(0).map((context) => context.close().catch(() => undefined)));
});

async function joinAs(browser: Browser, name: string, contextOptions = {}): Promise<{ context: BrowserContext; page: Page; id: string }> {
  const player = await openPlayer(browser, name, contextOptions);
  openContexts.push(player.context);
  return player;
}

const interaction = (page: Page) => page.evaluate(() => (window as any).__padova.interaction());
const playerSeenBy = async (observer: Page, id: string): Promise<DebugPlayer | undefined> =>
  (await observer.evaluate(() => (window as any).__padova.players() as DebugPlayer[])).find((p) => p.id === id);

/** Screen point to click/tap a target, checked to be on screen and to pick that target. */
async function targetPoint(page: Page, kind: "object" | "player", id: string) {
  const point = await page.evaluate(([k, i]) => (window as any).__padova.targetScreenPoint(k, i), [kind, id] as const);
  expect(point?.visible, `${kind} ${id} should be on screen`).toBe(true);
  // Objects: aim just below the top edge so the ray hits the top face.
  const aim = { x: point.x, y: kind === "object" ? point.y + 4 : point.y };
  const picked = await page.evaluate(([x, y]) => (window as any).__padova.pickAt(x, y), [aim.x, aim.y] as const);
  expect(picked, `pick at ${kind} ${id}`).toMatchObject(kind === "object" ? { kind: "object", id } : { kind: expect.stringMatching(/player|self/) });
  return aim;
}

async function waitForAllPlayers(pages: Page[], count: number) {
  for (const page of pages) {
    await expect.poll(() => page.evaluate(() => (window as any).__padova.players().length)).toBe(count);
  }
}

test("desktop: select a bench, sit, stand up from yourself, greet another player", async ({ browser }) => {
  test.setTimeout(150_000); // many steps with two software-rendered browsers; slow on 2-CPU machines
  const alice = await joinAs(browser, "Alice");
  const bruno = await joinAs(browser, "Bruno");
  await waitForAllPlayers([alice.page, bruno.page], 2);
  await alice.page.waitForTimeout(500); // let the camera settle on the player

  await test.step("dragging across an object rotates the camera and selects nothing", async () => {
    const bench = await targetPoint(alice.page, "object", "bench-1");
    await alice.page.mouse.move(bench.x, bench.y);
    await alice.page.mouse.down();
    await alice.page.mouse.move(bench.x + 40, bench.y + 5, { steps: 5 });
    await alice.page.mouse.move(bench.x + 80, bench.y + 10, { steps: 5 });
    await alice.page.mouse.up();
    expect(await interaction(alice.page)).toMatchObject({ selection: null, menu: null });
    // Put the camera back where it was for the next steps.
    await alice.page.mouse.move(bench.x + 80, bench.y + 10);
    await alice.page.mouse.down();
    await alice.page.mouse.move(bench.x, bench.y, { steps: 8 });
    await alice.page.mouse.up();
  });

  await test.step("hovering an object highlights it with a pointer cursor", async () => {
    const bench = await targetPoint(alice.page, "object", "bench-1");
    await alice.page.mouse.move(bench.x, bench.y);
    await expect.poll(() => alice.page.evaluate(() => document.querySelector("#game canvas")!.getAttribute("style") ?? "")).toContain("cursor: pointer");
  });

  await test.step("clicking the bench opens a radial menu with only valid actions", async () => {
    const bench = await targetPoint(alice.page, "object", "bench-1");
    await alice.page.mouse.click(bench.x, bench.y);
    await expect(alice.page.locator("#action-menu")).toBeVisible();
    expect(await interaction(alice.page)).toMatchObject({
      selection: { kind: "object", id: "bench-1" },
      menu: { kind: "radial", title: "Bench", options: ["Sit", "Sketch"] },
    });
    await alice.page.screenshot({ path: "test-results/m3-desktop-menu.png" });
  });

  await test.step("Escape closes the menu", async () => {
    await alice.page.keyboard.press("Escape");
    await expect(alice.page.locator("#action-menu")).toBeHidden();
    expect((await interaction(alice.page)).selection).toBeNull();
  });

  await test.step("choosing Sit walks to the bench and sits; the other player sees it", async () => {
    const bench = await targetPoint(alice.page, "object", "bench-1");
    await alice.page.mouse.click(bench.x, bench.y);
    await alice.page.click('#action-menu [data-action="sit"]');
    await expect(alice.page.locator("#action-progress")).toContainText("Going to sit");
    await expect.poll(async () => (await playerSeenBy(bruno.page, alice.id))?.activity, { timeout: 20_000 }).toBe("sitting");
    expect((await playerSeenBy(bruno.page, alice.id))?.seatId).toMatch(/^bench-1\//);
    await expect(alice.page.locator("#action-progress")).toBeHidden();
    await alice.page.screenshot({ path: "test-results/m3-desktop-seated.png" });
  });

  await test.step("clicking yourself while seated offers what you can do there, and your character panel", async () => {
    await alice.page.waitForTimeout(400);
    const self = await targetPoint(alice.page, "player", alice.id);
    expect(await alice.page.evaluate(([x, y]) => (window as any).__padova.pickAt(x, y), [self.x, self.y] as const)).toEqual({ kind: "self" });
    await alice.page.mouse.click(self.x, self.y);
    expect(await interaction(alice.page)).toMatchObject({ menu: { title: "Bench", subtitle: "You're sitting here", options: ["Sketch", "Stand up", "Character"] } });
    await alice.page.click('#action-menu [data-action="stand"]');
    await expect.poll(async () => (await playerSeenBy(bruno.page, alice.id))?.activity).toBe("idle");
    expect((await playerSeenBy(bruno.page, alice.id))?.seatId).toBe("");
  });

  await test.step("clicking another player offers Greet; they are notified and see the gesture", async () => {
    // Alice now faces north from the bench; Bruno walks into her view first.
    const spot = await bruno.page.evaluate(() => (window as any).__padova.worldToScreen(-3, -10));
    await bruno.page.mouse.click(spot.x, spot.y);
    await expect.poll(async () => {
      const b = (await playerSeenBy(alice.page, bruno.id)) as any;
      return b ? Math.hypot(b.x + 3, b.z + 10) : 99;
    }, { timeout: 20_000 }).toBeLessThan(0.6);
    await alice.page.waitForTimeout(400);
    const brunoOnAlice = await targetPoint(alice.page, "player", bruno.id);
    await alice.page.mouse.click(brunoOnAlice.x, brunoOnAlice.y);
    expect(await interaction(alice.page)).toMatchObject({
      selection: { kind: "player", id: bruno.id },
      menu: { title: "Bruno", options: ["Greet"] },
    });
    await alice.page.click('#action-menu [data-action="greet"]');
    await expect(bruno.page.locator("#toast")).toContainText('Alice says "Ciao!"', { timeout: 20_000 });
    await expect.poll(async () => (await playerSeenBy(bruno.page, alice.id))?.activity).toBe("greeting");
    expect((await playerSeenBy(bruno.page, alice.id))?.targetId).toBe(bruno.id);
    await bruno.page.screenshot({ path: "test-results/m3-greeting-seen-by-bruno.png" });
    await expect.poll(async () => (await playerSeenBy(bruno.page, alice.id))?.activity).toBe("idle");
  });

  await test.step("clicking yourself while standing offers your own options, never player actions", async () => {
    await alice.page.waitForTimeout(400);
    const self = await targetPoint(alice.page, "player", alice.id);
    await alice.page.mouse.click(self.x, self.y);
    expect(await interaction(alice.page)).toMatchObject({ menu: { title: "Alice", subtitle: "You", options: ["Character", "Edit appearance"] } });
    await alice.page.keyboard.press("Escape");
    await expect(alice.page.locator("#action-menu")).toBeHidden();
  });

  await test.step("a study desk offers Study and Sit, and the action can be cancelled while walking to it", async () => {
    const desk = await targetPoint(alice.page, "object", "desk-2"); // north-west of Alice, in view
    await alice.page.mouse.click(desk.x, desk.y);
    expect(await interaction(alice.page)).toMatchObject({ menu: { title: "Study desk", subtitle: "Free", options: ["Study", "Sit"] } });
    await alice.page.click('#action-menu [data-action="study"]');
    await expect(alice.page.locator("#action-progress")).toBeVisible();
    await alice.page.waitForTimeout(500);
    await alice.page.click("#action-progress .action-progress-cancel");
    await expect(alice.page.locator("#action-progress")).toBeHidden();
    // The reserved desk seat is released and Alice never starts studying.
    await expect.poll(async () => (await alice.page.evaluate(() => (window as any).__padova.seats() as [string, string][])).some(([, owner]) => owner === alice.id)).toBe(false);
    await alice.page.waitForTimeout(800);
    expect((await playerSeenBy(bruno.page, alice.id))?.activity).toBe("idle");
  });

});

test("mobile: tap targets open a touch-friendly action sheet", async ({ browser }) => {
  test.setTimeout(150_000);
  const phone = await joinAs(browser, "Chiara", { ...devices["Pixel 7"] });
  const desktop = await joinAs(browser, "Dario");
  await waitForAllPlayers([phone.page, desktop.page], 2);
  await phone.page.waitForTimeout(500);

  await test.step("tapping a bench opens a bottom sheet with large buttons and hides the joystick in portrait", async () => {
    const bench = await targetPoint(phone.page, "object", "bench-2");
    await phone.page.touchscreen.tap(bench.x, bench.y);
    const sheet = phone.page.locator("#action-sheet");
    await expect(sheet).toBeVisible();
    expect(await interaction(phone.page)).toMatchObject({ menu: { kind: "sheet", title: "Bench", options: ["Sit", "Sketch"] } });
    const button = sheet.locator('[data-action="sit"]');
    const box = (await button.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(48);
    expect(box.width).toBeGreaterThanOrEqual(200);
    await expect(phone.page.locator("#joystick")).toBeHidden();
    await phone.page.screenshot({ path: "test-results/m3-phone-sheet.png" });
  });

  await test.step("the close button dismisses the sheet and restores the joystick", async () => {
    await phone.page.locator("#action-sheet .sheet-close").tap();
    await expect(phone.page.locator("#action-sheet")).toBeHidden();
    await expect(phone.page.locator("#joystick")).toBeVisible();
    expect((await interaction(phone.page)).selection).toBeNull();
  });

  await test.step("tapping Sit in the sheet sits; the desktop player sees it", async () => {
    const bench = await targetPoint(phone.page, "object", "bench-2");
    await phone.page.touchscreen.tap(bench.x, bench.y);
    await phone.page.locator('#action-sheet [data-action="sit"]').tap();
    await expect.poll(async () => (await playerSeenBy(desktop.page, phone.id))?.activity, { timeout: 20_000 }).toBe("sitting");
  });

  await test.step("a seated touch player can greet another player via the sheet", async () => {
    // Dario walks next to the bench so Chiara can see and greet him.
    const spot = await desktop.page.evaluate(() => (window as any).__padova.worldToScreen(3, -5));
    const seat = (await playerSeenBy(desktop.page, phone.id))!;
    expect(seat).toBeTruthy();
    await desktop.page.mouse.click(spot.x, spot.y);
    await expect.poll(async () => {
      const d = await playerSeenBy(phone.page, desktop.id);
      return d ? Math.hypot((d as any).x - 3, (d as any).z + 5) : 99;
    }, { timeout: 20_000 }).toBeLessThan(0.6);
    await phone.page.waitForTimeout(300);
    const dario = await targetPoint(phone.page, "player", desktop.id);
    await phone.page.touchscreen.tap(dario.x, dario.y);
    expect(await interaction(phone.page)).toMatchObject({ menu: { kind: "sheet", title: "Dario", options: ["Greet"] } });
    await phone.page.locator('#action-sheet [data-action="greet"]').tap();
    await expect(desktop.page.locator("#toast")).toContainText('Chiara says "Ciao!"', { timeout: 20_000 });
  });

});
