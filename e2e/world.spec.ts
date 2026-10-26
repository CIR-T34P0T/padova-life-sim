// The first district in the real game (world art pass, D-033): the art is
// built and within budget, solid props refuse taps with their name, café
// tables work and replicate, and the portico houses fade while you walk
// under them.

import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { createCharacter } from "./helpers.ts";

const openContexts: BrowserContext[] = [];
test.afterEach(async () => {
  await Promise.all(openContexts.splice(0).map((context) => context.close().catch(() => undefined)));
});

async function newPlayer(browser: Browser, name: string, quality?: "high"): Promise<Page> {
  const context = await browser.newContext();
  openContexts.push(context);
  const page = await context.newPage();
  page.on("pageerror", (error) => console.error(`[${name}] page error:`, error.message));
  await page.goto(quality ? `/?quality=${quality}` : "/");
  await createCharacter(page, name);
  return page;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const game = (page: Page) => page.evaluate(() => (window as any).__padova);
const me = (page: Page) =>
  page.evaluate(() => {
    const g = (window as any).__padova;
    return g.players().find((p: { id: string }) => p.id === g.selfId) as { id: string; x: number; z: number; moving: boolean; activity: string; seatId: string };
  });
const worldStats = (page: Page) => page.evaluate(() => (window as any).__padova.worldStats());
const pickGround = (page: Page, x: number, z: number) =>
  page.evaluate(([px, pz]) => {
    const g = (window as any).__padova;
    const p = g.worldToScreen(px, pz);
    return { point: p, pick: g.pickAt(p.x, p.y) };
  }, [x, z] as const);

/** Clicks open ground (checked to be on screen and not hidden) and waits until the character stands there. */
async function walkTo(page: Page, x: number, z: number) {
  const { point, pick } = await pickGround(page, x, z);
  const view = page.viewportSize()!;
  const onScreen = point.x > 8 && point.x < view.width - 8 && point.y > 8 && point.y < view.height - 8;
  expect(onScreen, `ground at (${x}, ${z}) should be on screen (${Math.round(point.x)}, ${Math.round(point.y)})`).toBe(true);
  expect(pick, `ground at (${x}, ${z}) should be tappable`).toMatchObject({ kind: "ground" });
  await page.mouse.click(point.x, point.y);
  await expect.poll(async () => {
    const self = await me(page);
    return Math.hypot(self.x - x, self.z - z) < 0.5 && !self.moving;
  }, { timeout: 30_000 }).toBe(true);
  await cameraSettled(page, x, z);
}

/** Waits until the camera has stopped gliding after the character (a fixed point stops moving on screen). */
async function cameraSettled(page: Page, x: number, z: number) {
  let last = await page.evaluate(([px, pz]) => (window as any).__padova.worldToScreen(px, pz), [x, z] as const);
  await expect.poll(async () => {
    const next = await page.evaluate(([px, pz]) => (window as any).__padova.worldToScreen(px, pz), [x, z] as const);
    const still = Math.hypot(next.x - last.x, next.y - last.y) < 1;
    last = next;
    return still;
  }, { timeout: 10_000, intervals: [250] }).toBe(true);
}

/**
 * Walks to the first of several nearby ground points that is on screen and
 * not hidden behind something (e.g. a portico column, which hides a
 * different spot depending on exactly where the last walk ended).
 */
async function walkToAny(page: Page, points: readonly (readonly [number, number])[]) {
  const view = page.viewportSize()!;
  for (const [x, z] of points) {
    const { point, pick } = await pickGround(page, x, z);
    const onScreen = point.x > 8 && point.x < view.width - 8 && point.y > 8 && point.y < view.height - 8;
    if (onScreen && pick?.kind === "ground") return walkTo(page, x, z);
  }
  throw new Error(`none of ${JSON.stringify(points)} could be tapped`);
}

test("the district is built, solid props refuse taps by name, café tables work for everyone, the portico fades over you", async ({ browser }) => {
  test.setTimeout(300_000); // two software-rendered browsers on 2 CPUs
  // Alice sees the full-detail world (what a computer gets); Bruno the light one.
  const alice = await newPlayer(browser, "Alice", "high");
  const bruno = await newPlayer(browser, "Bruno");
  void game;

  await test.step("the district art is built within its budget at both detail levels", async () => {
    const stats = await worldStats(alice);
    expect(stats.detail).toBe("high");
    expect(stats.meshes).toBeGreaterThan(40);
    expect(stats.triangles).toBeGreaterThan(80_000);
    expect(stats.triangles).toBeLessThan(220_000);
    const light = await worldStats(bruno);
    expect(light.detail).toBe("low");
    expect(light.triangles).toBeLessThan(stats.triangles);
    expect(light.triangles).toBeLessThan(110_000);
    console.log(`[world perf] build ${stats.buildMs.toFixed(0)} ms, ${stats.meshes} meshes, ${stats.triangles} triangles; render ${JSON.stringify(await alice.evaluate(() => (window as any).__padova.renderStats()))}`);
  });

  await test.step("on arrival the shops beside the camera are see-through and let taps pass (D-035)", async () => {
    // The first player arrives at (0, 13); the camera stands 3 m from the shops.
    const self = await me(alice);
    expect([self.x, self.z]).toEqual([0, 13]);
    await expect.poll(async () => (await worldStats(alice)).faded, { timeout: 10_000 }).toContain("building:shops");
    // Ground seen through the faded shops can be tapped (it hit the shops' box before).
    const { pick } = await pickGround(alice, 11, 12);
    expect(pick).toMatchObject({ kind: "ground" });
  });

  await test.step("tapping a tree is refused and says what it is", async () => {
    // From the arrival area the shops hide this corner; from beside the café
    // kiosk the plane tree is in clear view.
    await walkTo(alice, 9, 6);
    // Aim at the trunk, a little above its foot.
    const foot = await alice.evaluate(() => (window as any).__padova.worldToScreen(12.5, 5.5));
    const trunk = { x: foot.x, y: foot.y - 20 };
    expect(await alice.evaluate(([x, y]) => (window as any).__padova.pickAt(x, y), [trunk.x, trunk.y] as const)).toMatchObject({ kind: "blocked", label: "Plane tree" });
    await alice.mouse.click(trunk.x, trunk.y);
    await expect(alice.locator("#toast")).toContainText("Plane tree: you can't walk there.");
  });

  await test.step("a café table offers Study and Sit; sitting is seen by the other player", async () => {
    // Still beside the kiosk: the table is in view, and the character walks to it.
    // Aim once the camera has stopped gliding (a full run once caught it mid-glide, 2026-10-26).
    const read = () => alice.evaluate(() => (window as any).__padova.targetScreenPoint("object", "cafe-table-1"));
    let table = await read();
    await expect.poll(async () => {
      const next = await read();
      const still = Math.hypot(next.x - table.x, next.y - table.y) < 1;
      table = next;
      return still;
    }, { timeout: 10_000, intervals: [250] }).toBe(true);
    expect(table.visible).toBe(true);
    const aim = { x: table.x, y: table.y + 4 };
    expect(await alice.evaluate(([x, y]) => (window as any).__padova.pickAt(x, y), [aim.x, aim.y] as const)).toMatchObject({ kind: "object", id: "cafe-table-1" });
    await alice.mouse.click(aim.x, aim.y);
    await expect(alice.locator("#action-menu")).toBeVisible();
    expect((await alice.evaluate(() => (window as any).__padova.interaction())).menu).toMatchObject({ title: "Café table", options: ["Study", "Sit"] });
    await alice.click('#action-menu [data-action="sit"]');
    await expect.poll(async () => (await me(alice)).activity, { timeout: 30_000 }).toBe("sitting");
    const seated = await me(alice);
    expect(seated.seatId).toMatch(/^cafe-table-1\/seat-[ab]$/);
    await expect.poll(async () => {
      const seen = (await bruno.evaluate(() => (window as any).__padova.players())).find((p: { id: string }) => p.id === seated.id);
      return seen ? `${seen.activity} ${seen.seatId}` : "";
    }, { timeout: 15_000 }).toBe(`sitting ${seated.seatId}`);
    await alice.screenshot({ path: "test-results/world-cafe-table.png" });
  });

  await test.step("walking into the portico fades the houses above you, and leaving brings them back", async () => {
    await walkTo(alice, 11, 6);
    await expect.poll(async () => (await worldStats(alice)).faded, { timeout: 10_000 }).not.toContain("building:portico");
    // From here on the camera is within 3.5 m of the floors over the walkway,
    // so they fade before you are under them (the near-camera rule, D-035).
    await walkTo(alice, 15.5, 3);
    // Into the walkway behind the columns, between two of them.
    await walkToAny(alice, [[18.5, 2], [18.5, 1.5], [18.5, 2.5], [18.3, 1], [18.3, 3]]);
    await expect.poll(async () => (await worldStats(alice)).faded, { timeout: 10_000 }).toContain("building:portico");
    await alice.screenshot({ path: "test-results/world-portico.png" });
    // The walkway runs end to end behind the columns.
    await walkTo(alice, 18.5, -8);
    await walkTo(alice, 14, -10);
    // A little further west: at x = 14 the camera is still within 3.5 m of the
    // floors over the walkway, so they stay faded (the near-camera rule, D-035).
    await walkToAny(alice, [[12, -10], [11.5, -10], [12, -11]]);
    await expect.poll(async () => (await worldStats(alice)).faded, { timeout: 10_000 }).not.toContain("building:portico");
  });
});
