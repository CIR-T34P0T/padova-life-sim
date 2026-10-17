// M4 persistence flows in real browsers: create a character once, get it back
// after a reload (look and position), edit appearance, a second tab taking
// over, and an unrecognised saved identity. The browser keeps only the
// temporary guest token; everything else comes from the server's database.

import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { createCharacter, waitUntilPlaying } from "./helpers.ts";

interface DebugPlayer {
  id: string;
  name: string;
  x: number;
  z: number;
  preset: string;
  skinTone: string;
  hairStyle: string;
  hairColour: string;
  eyeColour: string;
  outfit: string;
}

const TOKEN_KEY = "padova.guestToken.v1";
const openContexts: BrowserContext[] = [];
test.afterEach(async () => {
  await Promise.all(openContexts.splice(0).map((context) => context.close().catch(() => undefined)));
});

async function newContext(browser: import("@playwright/test").Browser): Promise<BrowserContext> {
  const context = await browser.newContext();
  openContexts.push(context);
  return context;
}

const self = async (page: Page): Promise<DebugPlayer> =>
  page.evaluate(() => {
    const game = (window as any).__padova;
    return game.players().find((p: DebugPlayer) => p.id === game.selfId);
  });
const seenBy = async (observer: Page, name: string): Promise<DebugPlayer | undefined> =>
  (await observer.evaluate(() => (window as any).__padova.players() as DebugPlayer[])).find((p) => p.name === name);
const token = (page: Page) => page.evaluate((key) => localStorage.getItem(key), TOKEN_KEY);

test("a character is created once and comes back after a reload with its look and position", async ({ browser }) => {
  const context = await newContext(browser);
  const page = await context.newPage();
  await page.goto("/");
  const look = { preset: "male", hairStyle: "bun", hairColour: "teal", eyeColour: "green", outfit: "hoodie-navy", skinTone: "skin-6" };
  await createCharacter(page, "Giulia", look);
  expect(await self(page)).toMatchObject({ name: "Giulia", ...look });
  const savedToken = await token(page);
  expect(savedToken).toMatch(/^plsg1_/);

  // Walk somewhere, then reload.
  const spot = await page.evaluate(() => (window as any).__padova.worldToScreen(-7, 11));
  await page.mouse.click(spot.x, spot.y);
  await expect.poll(async () => {
    const me = await self(page);
    return Math.hypot(me.x + 7, me.z - 11);
  }, { timeout: 15_000 }).toBeLessThan(0.3);

  await page.reload();
  // A returning player never sees the create form.
  await waitUntilPlaying(page, "Giulia after reload");
  expect(await page.locator('#profile-panel[data-mode="create"]').count()).toBe(0);
  const back = await self(page);
  expect(back).toMatchObject({ name: "Giulia", ...look });
  expect(Math.hypot(back.x + 7, back.z - 11)).toBeLessThan(0.3);
  expect(await token(page)).toBe(savedToken); // same identity, nothing new issued
});

test("appearance changes are saved, seen by other players, and kept after a reload", async ({ browser }) => {
  const aliceContext = await newContext(browser);
  const alice = await aliceContext.newPage();
  await alice.goto("/");
  await createCharacter(alice, "Alice", { hairColour: "black" });
  const brunoContext = await newContext(browser);
  const bruno = await brunoContext.newPage();
  await bruno.goto("/");
  await createCharacter(bruno, "Bruno");
  await expect.poll(async () => (await seenBy(bruno, "Alice"))?.hairColour).toBe("black");

  // Open your own menu by clicking yourself, then "Edit appearance".
  await alice.waitForTimeout(500);
  const me = await alice.evaluate(() => (window as any).__padova.targetScreenPoint("player", (window as any).__padova.selfId));
  await alice.mouse.click(me.x, me.y);
  await alice.click('#action-menu [data-action="edit-appearance"]');
  await expect(alice.locator('#profile-panel[data-mode="edit"]')).toBeVisible();
  await alice.click('#profile-panel .picker-group[data-field="hairColour"] [data-value="silver"]');
  await alice.click('#profile-panel .picker-group[data-field="outfit"] [data-value="dress-plum"]');
  await alice.click("#profile-panel button.primary");
  await expect(alice.locator("#profile-panel")).toBeHidden();

  await expect.poll(async () => (await seenBy(bruno, "Alice"))?.hairColour).toBe("silver");
  expect((await seenBy(bruno, "Alice"))?.outfit).toBe("dress-plum");
  await alice.screenshot({ path: "test-results/m4-after-edit.png" });

  await alice.reload();
  await waitUntilPlaying(alice, "Alice after reload");
  expect(await self(alice)).toMatchObject({ name: "Alice", hairColour: "silver", outfit: "dress-plum" });
});

test("opening the game in a second tab moves the character there; the first tab is told", async ({ browser }) => {
  const context = await newContext(browser); // tabs in one context share the saved token, like one browser
  const first = await context.newPage();
  await first.goto("/");
  await createCharacter(first, "Chiara");

  const second = await context.newPage();
  await second.goto("/");
  await waitUntilPlaying(second, "Chiara in the second tab");
  expect((await self(second)).name).toBe("Chiara");

  await expect(first.locator('#profile-panel[data-mode="message"]')).toContainText("Playing in another window");
  // Only one Chiara exists in the world.
  await expect.poll(async () => (await second.evaluate(() => (window as any).__padova.players() as DebugPlayer[])).filter((p) => p.name === "Chiara").length).toBe(1);
  await first.screenshot({ path: "test-results/m4-signed-in-elsewhere.png" });
});

test("an unrecognised saved identity starts over and says so", async ({ browser }) => {
  const context = await newContext(browser);
  // A well-formed token this server has never issued (e.g. after a database reset).
  await context.addInitScript((key) => {
    if (!sessionStorage.getItem("seeded")) {
      localStorage.setItem(key, "plsg1_" + "A".repeat(43));
      sessionStorage.setItem("seeded", "1");
    }
  }, TOKEN_KEY);
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.locator('#profile-panel[data-mode="create"]')).toContainText("couldn't find your saved guest profile", { timeout: 15_000 });
  expect(await token(page)).toBeNull(); // the stale token was discarded
  await createCharacter(page, "Dario");
  expect(await token(page)).toMatch(/^plsg1_/);
});
