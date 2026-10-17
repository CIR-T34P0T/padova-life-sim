// Walking-skeleton acceptance test: two desktop players and one phone-sized
// touch player share the piazza, see each other and move with every input
// method. The phone is Chromium mobile EMULATION (touch, small viewport,
// mobile user agent), not a physical device.

import { devices, expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

interface DebugPlayer {
  id: string;
  name: string;
  x: number;
  z: number;
  moving: boolean;
  connected: boolean;
}

async function joinAs(browser: Browser, name: string, contextOptions = {}): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  page.on("pageerror", (error) => console.error(`[${name}] page error:`, error.message));
  await page.goto("/");
  await page.fill("#name", name);
  await page.click("#join-button");
  // Generous timeout: the first page load compiles on demand under Vite and
  // test machines may render WebGL in software. A failed join shows its error.
  try {
    await expect(page.locator("#join")).toBeHidden({ timeout: 15_000 });
  } catch (error) {
    const shown = await page.locator("#join-error").textContent();
    throw new Error(`${name} could not join (on-screen error: "${shown}")`, { cause: error });
  }
  await page.waitForFunction(() => (window as any).__padova?.status === "connected");
  return { context, page };
}

const players = (page: Page) => page.evaluate(() => (window as any).__padova.players() as DebugPlayer[]);
const selfId = (page: Page) => page.evaluate(() => (window as any).__padova.selfId as string);

async function positionSeenBy(observer: Page, id: string) {
  const list = await players(observer);
  const player = list.find((p) => p.id === id);
  if (!player) throw new Error(`player ${id} not visible`);
  return player;
}

async function screenPointFor(page: Page, x: number, z: number) {
  return page.evaluate(([px, pz]) => (window as any).__padova.worldToScreen(px, pz), [x, z] as const);
}

test("two desktop players and a touch player share the piazza", async ({ browser }) => {
  const alice = await joinAs(browser, "Alice");
  const bruno = await joinAs(browser, "Bruno");
  const phone = await joinAs(browser, "Chiara", { ...devices["Pixel 7"] });

  const aliceId = await selfId(alice.page);
  const phoneId = await selfId(phone.page);

  await test.step("everyone sees all three players", async () => {
    for (const { page } of [alice, bruno, phone]) {
      await expect.poll(async () => (await players(page)).length).toBe(3);
      await expect(page.locator("#players")).toHaveText("3 players here");
    }
    await expect.poll(async () => (await players(bruno.page)).map((p) => p.name).sort()).toEqual(["Alice", "Bruno", "Chiara"]);
    expect(await phone.page.evaluate(() => (window as any).__padova.quality)).toBe("low");
    await expect(phone.page.locator("#joystick")).toBeVisible();
    await expect(alice.page.locator("#joystick")).toBeHidden();
  });

  await test.step("desktop click-to-move is replicated to the others", async () => {
    const target = { x: -7, z: 11 }; // open ground with no stall between camera and target
    const point = await screenPointFor(alice.page, target.x, target.z);
    await alice.page.mouse.click(point.x, point.y);
    await expect
      .poll(async () => {
        const seen = await positionSeenBy(bruno.page, aliceId);
        return Math.hypot(seen.x - target.x, seen.z - target.z);
      }, { timeout: 15_000 })
      .toBeLessThan(0.6);
    const brunoSawArrivalAt = Date.now();
    await expect
      .poll(async () => {
        const seen = await positionSeenBy(phone.page, aliceId);
        return Math.hypot(seen.x - target.x, seen.z - target.z);
      }, { timeout: 10_000 })
      .toBeLessThan(0.6);
    console.log(`phone saw the arrival ${Date.now() - brunoSawArrivalAt} ms after Bruno`);
    await alice.page.screenshot({ path: "test-results/desktop-alice.png" });
  });

  await test.step("touch tap-to-move is replicated to the others", async () => {
    // A point straight ahead of the player, which is always on a portrait screen.
    const start = await positionSeenBy(phone.page, phoneId);
    const target = { x: start.x, z: start.z - 2.5 };
    const point = await screenPointFor(phone.page, target.x, target.z);
    const viewport = phone.page.viewportSize()!;
    expect(point.x).toBeGreaterThan(0);
    expect(point.x).toBeLessThan(viewport.width);
    expect(point.y).toBeGreaterThan(0);
    expect(point.y).toBeLessThan(viewport.height);
    await phone.page.touchscreen.tap(point.x, point.y);
    await expect
      .poll(async () => {
        const seen = await positionSeenBy(alice.page, phoneId);
        return Math.hypot(seen.x - target.x, seen.z - target.z);
      }, { timeout: 15_000 })
      .toBeLessThan(0.6);
    await phone.page.screenshot({ path: "test-results/phone-chiara.png" });
  });

  await test.step("keyboard movement works on desktop", async () => {
    const before = await positionSeenBy(bruno.page, aliceId);
    await alice.page.keyboard.down("KeyW");
    await alice.page.waitForTimeout(800);
    await alice.page.keyboard.up("KeyW");
    await expect
      .poll(async () => {
        const after = await positionSeenBy(bruno.page, aliceId);
        return Math.hypot(after.x - before.x, after.z - before.z);
      })
      .toBeGreaterThan(1);
    await expect.poll(async () => (await positionSeenBy(bruno.page, aliceId)).moving).toBe(false);
  });

  await test.step("the virtual joystick moves the touch player", async () => {
    const before = await positionSeenBy(alice.page, phoneId);
    const box = (await phone.page.locator("#joystick").boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    // Drive the joystick with real touch pointer events through CDP.
    const cdp = await phone.context.newCDPSession(phone.page);
    const touch = (type: string, x: number, y: number) =>
      cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });
    await touch("touchStart", cx, cy);
    await touch("touchMove", cx, cy - box.height * 0.45);
    await phone.page.waitForTimeout(900);
    await touch("touchEnd", cx, cy);
    await expect
      .poll(async () => {
        const after = await positionSeenBy(alice.page, phoneId);
        return Math.hypot(after.x - before.x, after.z - before.z);
      })
      .toBeGreaterThan(1);
  });

  await test.step("tapping a building is refused with feedback and no movement", async () => {
    const before = await positionSeenBy(bruno.page, aliceId);
    const building = await screenPointFor(alice.page, 0, -3); // fountain centre
    await alice.page.mouse.click(building.x, building.y - 10);
    await expect(alice.page.locator("#toast")).toBeVisible();
    await expect(alice.page.locator("#toast")).toContainText("can't walk there");
    await alice.page.waitForTimeout(500);
    const after = await positionSeenBy(bruno.page, aliceId);
    expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeLessThan(0.05);
  });

  await test.step("closing a tab removes that player for everyone", async () => {
    await alice.context.close();
    for (const { page } of [bruno, phone]) {
      await expect.poll(async () => (await players(page)).length).toBe(2);
      await expect(page.locator("#players")).toHaveText("2 players here");
    }
  });

  await bruno.context.close();
  await phone.context.close();
});
