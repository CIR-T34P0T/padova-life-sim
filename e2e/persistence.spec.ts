// M4 persistence flows in real browsers: create a character once, get it back
// after a reload (title screen → Continue: look and position), edit the look,
// a second tab taking over, and an unrecognised saved identity. The browser
// keeps only the temporary guest token; everything else comes from the
// server's database.

import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { chooseAppearance, continueFromTitle, createCharacter, lookOf, waitForTitle } from "./helpers.ts";

interface DebugPlayer {
  id: string;
  name: string;
  x: number;
  z: number;
  /** Appearance config as JSON (decode with lookOf). */
  look: string;
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
  const choices = { "body.frame": "masculine", "hair.style": "top-bun", "hair.colour": "teal", "face.eyeColour": "green", "outfit.top": "hoodie", "outfit.topColour": "navy", "skin.tone": 0.72 };
  await createCharacter(page, "Giulia", choices);
  const expected = { body: { frame: "masculine" }, hair: { style: "top-bun", colour: "teal" }, face: { eyeColour: "green" }, outfit: { top: "hoodie", topColour: "navy" }, skin: { tone: 0.72 } };
  expect(await self(page)).toMatchObject({ name: "Giulia" });
  expect(lookOf(await self(page))).toMatchObject(expected);
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
  // A returning player gets the title screen with Continue for their character.
  await waitForTitle(page);
  await expect(page.locator('#screens [data-action="continue"]')).toContainText("as Giulia");
  await continueFromTitle(page, "Giulia after reload");
  const back = await self(page);
  expect(back).toMatchObject({ name: "Giulia" });
  expect(lookOf(back)).toMatchObject(expected);
  expect(Math.hypot(back.x + 7, back.z - 11)).toBeLessThan(0.3);
  expect(await token(page)).toBe(savedToken); // same identity, nothing new issued
});

test("appearance changes are saved, seen by other players, and kept after a reload", async ({ browser }) => {
  test.setTimeout(300_000); // two software-rendered browsers, the creator twice, a reload and the title screen; slow on 2-CPU machines
  const aliceContext = await newContext(browser);
  const alice = await aliceContext.newPage();
  await alice.goto("/");
  await createCharacter(alice, "Alice", { "hair.colour": "black" });
  const brunoContext = await newContext(browser);
  const bruno = await brunoContext.newPage();
  await bruno.goto("/");
  await createCharacter(bruno, "Bruno");
  await expect.poll(async () => lookOf(await seenBy(bruno, "Alice"))?.hair.colour).toBe("black");

  // Open your own menu by clicking yourself, then "Edit look" → change → review → save.
  await alice.waitForTimeout(500);
  const me = await alice.evaluate(() => (window as any).__padova.targetScreenPoint("player", (window as any).__padova.selfId));
  await alice.mouse.click(me.x, me.y);
  await alice.click('#action-menu [data-action="edit-appearance"]');
  await expect(alice.locator('#screens .creator[data-mode="edit"]')).toBeVisible();
  await chooseAppearance(alice, { "hair.colour": "silver", "outfit.full": "dress", "outfit.topColour": "plum" });
  await alice.click('#screens [data-action="creator-review"]');
  await expect(alice.locator("#screens .review-changes")).toContainText("Hair, Clothing");
  await alice.click('#screens [data-action="save-look"]');
  await expect(alice.locator("#screens")).toBeHidden();

  await expect.poll(async () => lookOf(await seenBy(bruno, "Alice"))?.hair.colour).toBe("silver");
  expect(lookOf(await seenBy(bruno, "Alice"))?.outfit).toMatchObject({ full: "dress", topColour: "plum" });
  await alice.screenshot({ path: "test-results/m4-after-edit.png" });

  await alice.reload();
  await continueFromTitle(alice, "Alice after reload");
  expect(lookOf(await self(alice))).toMatchObject({ hair: { colour: "silver" }, outfit: { full: "dress", topColour: "plum" } });
});

test("opening the game in a second tab moves the character there; the first tab is told", async ({ browser }) => {
  const context = await newContext(browser); // tabs in one context share the saved token, like one browser
  const first = await context.newPage();
  await first.goto("/");
  await createCharacter(first, "Chiara");

  const second = await context.newPage();
  await second.goto("/");
  // Only opening the title screen in the second tab doesn't disconnect the first.
  await waitForTitle(second);
  await second.waitForTimeout(500);
  expect(await first.evaluate(() => (window as any).__padova.inWorld)).toBe(true);
  await continueFromTitle(second, "Chiara in the second tab");
  expect((await self(second)).name).toBe("Chiara");

  await expect(first.locator('#screens [data-screen="message"]')).toContainText("Playing in another window");
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
  await waitForTitle(page);
  await expect(page.locator("#screens .title-status")).toContainText("couldn't find your saved guest profile");
  expect(await token(page)).toBeNull(); // the stale token was discarded
  await createCharacter(page, "Dario");
  expect(await token(page)).toMatch(/^plsg1_/);
});
