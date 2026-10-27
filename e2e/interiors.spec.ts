// Indoor rooms (M7c, D-039) in real browsers against the real server:
// go into the university hall's lecture room through its door, study at a
// desk inside, see only the players in the same room, come back inside after
// a reload, and go out to the square. Phone: the door's sheet and the way out.
// The phone is Chromium mobile emulation (Pixel 7), not a physical device.

import { devices, expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { continueFromTitle, createCharacter, me, objectPoint, players, selfId, useObject, walkTo } from "./helpers.ts";

const ROOM = "hall/lecture-room";
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

const worldStats = (page: Page) => page.evaluate(() => (window as any).__padova.worldStats() as { indoor: boolean });
const interaction = (page: Page) => page.evaluate(() => (window as any).__padova.interaction());
const area = (page: Page) => page.evaluate(() => (window as any).__padova.area as string);
test("desktop: into the lecture room and out again; only players in the same room see each other; a reload comes back inside", async ({ browser }) => {
  test.setTimeout(300_000);
  const ada = await newPlayer(browser, "Ada");
  const ben = await newPlayer(browser, "Ben");
  const adaId = await selfId(ada);
  const benId = await selfId(ben);
  await expect.poll(async () => (await players(ben)).length).toBe(2);

  await test.step("the hall's door offers 'Go in'; going in draws the lecture room", async () => {
    await walkTo(ada, -6, -10);
    await walkTo(ada, -12.5, -16);
    await expect(async () => {
      const aim = await objectPoint(ada, "hall-door");
      await ada.mouse.click(aim.x, aim.y);
      await expect(ada.locator("#action-menu")).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
    expect(await interaction(ada)).toMatchObject({ menu: { title: "University hall", options: ["Go in"] } });
    await ada.click('#action-menu [data-action="enter"]');
    await expect.poll(() => area(ada), { timeout: 20_000 }).toBe(ROOM);
    await expect(ada.locator("#toast")).toContainText("Lecture room");
    expect((await worldStats(ada)).indoor).toBe(true);
    expect((await me(ada)).area).toBe(ROOM);
  });

  await test.step("only players in the same area are sent: Ada and Ben no longer see each other", async () => {
    await expect.poll(async () => (await players(ben)).map((p) => p.id)).toEqual([benId]);
    await expect.poll(async () => (await players(ada)).map((p) => p.id)).toEqual([adaId]);
    await expect(ben.locator("#players")).toHaveText("1 player here");
  });

  await test.step("a lecture desk inside offers Study, and studying works", async () => {
    await ada.waitForTimeout(500);
    await useObject(ada, "lecture-desk-3a", "study");
    await expect.poll(async () => (await me(ada)).activity, { timeout: 20_000 }).toBe("studying");
    await ada.screenshot({ path: "test-results/m7c-desktop-lecture-room.png" });
  });

  await test.step("Ben comes in too: they see each other again", async () => {
    await walkTo(ben, -6, -10);
    await walkTo(ben, -12.5, -16);
    await useObject(ben, "hall-door", "enter");
    await expect.poll(() => area(ben), { timeout: 20_000 }).toBe(ROOM);
    await expect.poll(async () => (await players(ben)).map((p) => p.id).sort(), { timeout: 10_000 }).toEqual([adaId, benId].sort());
    await expect.poll(async () => (await players(ada)).find((p) => p.id === benId)?.area, { timeout: 10_000 }).toBe(ROOM);
  });

  await test.step("reload: Ada comes back inside the room, drawn from the first frame", async () => {
    await ada.reload();
    await continueFromTitle(ada, "Ada");
    await expect.poll(() => area(ada), { timeout: 20_000 }).toBe(ROOM);
    expect((await worldStats(ada)).indoor).toBe(true);
  });

  await test.step("the room's door leads out to the square, in front of the hall", async () => {
    await ada.waitForTimeout(500);
    await useObject(ada, "lecture-room-door", "enter");
    await expect.poll(() => area(ada), { timeout: 20_000 }).toBe("plaza");
    const self = await me(ada);
    expect(Math.abs(self.z - -18.7)).toBeLessThan(0.3);
    await expect(ada.locator("#toast")).toContainText("Back on the square");
  });
});

test("mobile: the door's sheet has a large 'Go in', and the way out works by touch", async ({ browser }) => {
  test.setTimeout(150_000);
  const page = await newPlayer(browser, "Chiara", { ...devices["Pixel 7"] });
  await page.waitForTimeout(500);
  await walkTo(page, -6, -8, true);
  await walkTo(page, -12.5, -15, true);
  const sheet = page.locator("#action-sheet");
  await expect(async () => {
    const aim = await objectPoint(page, "hall-door");
    await page.touchscreen.tap(aim.x, aim.y);
    await expect(sheet).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  const goIn = sheet.locator('[data-action="enter"]');
  await expect(goIn).toContainText("Go in");
  expect((await goIn.boundingBox())!.height).toBeGreaterThanOrEqual(48);
  await goIn.tap();
  await expect.poll(() => area(page), { timeout: 20_000 }).toBe(ROOM);
  await page.waitForTimeout(600);
  await page.screenshot({ path: "test-results/m7c-phone-lecture-room.png" });
  await useObject(page, "lecture-room-door", "enter", true);
  await expect.poll(() => area(page), { timeout: 20_000 }).toBe("plaza");
});
