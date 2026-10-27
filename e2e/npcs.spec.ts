// Non-player characters (M11) in real browsers against the real server. The
// suite's clock runs from Wednesday 09:00, so whenever this spec runs the
// barista is on the square (working at the café kiosk, or on her lunch break
// at a café table). Desktop: she has a gold name tag with her role, isn't
// counted as a player, her menu offers only Greet ("Barista · not a player"),
// and greeting her gets an answer. Phone (Pixel 7 emulation): her menu as a
// bottom sheet with a large Greet button.

import { devices, expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { createCharacter, openPlayerMenu, players, walkTo } from "./helpers.ts";

const GIULIA = "npc-giulia";

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

const npcs = (page: Page) => page.evaluate(() => (window as any).__padova.npcs() as { id: string; name: string; role: string; area: string; activity: string }[]);
const interaction = (page: Page) => page.evaluate(() => (window as any).__padova.interaction());

test("desktop: the barista is marked as a local, not counted as a player, and answers a greeting", async ({ browser }) => {
  test.setTimeout(150_000);
  const ada = await newPlayer(browser, "Ada");
  await expect.poll(async () => (await npcs(ada)).find((n) => n.id === GIULIA), { timeout: 20_000 }).toMatchObject({ name: "Giulia", role: "Barista", area: "plaza" });
  expect((await players(ada)).map((p) => p.id)).not.toContain(GIULIA);
  await expect(ada.locator("#players")).toHaveText("1 player here");
  await expect(ada.locator(".name-tag.is-npc", { hasText: "Giulia" })).toContainText("Barista");

  await openPlayerMenu(ada, GIULIA);
  expect(await interaction(ada)).toMatchObject({ menu: { title: "Giulia", subtitle: "Barista · not a player", options: ["Greet"] } });
  await ada.screenshot({ path: "test-results/m11-desktop-menu.png" });
  await ada.click('#action-menu [data-action="greet"]');
  await expect(ada.locator("#toast")).toContainText("Giulia: “", { timeout: 20_000 });
  await ada.screenshot({ path: "test-results/m11-desktop-reply.png" });
});

test("mobile: the NPC's menu is a bottom sheet with a large Greet button", async ({ browser }) => {
  test.setTimeout(120_000);
  const chiara = await newPlayer(browser, "Chiara", { ...devices["Pixel 7"] });
  await expect.poll(async () => (await npcs(chiara)).some((n) => n.id === GIULIA), { timeout: 20_000 }).toBe(true);
  // Closer to the café (a portrait screen shows little to the sides), in short hops.
  for (const [x, z] of [[2.5, 12.8], [5, 12.8], [7.2, 13.2]] as const) await walkTo(chiara, x, z, true);
  const sheet = await openPlayerMenu(chiara, GIULIA, true);
  const greet = sheet.locator('[data-action="greet"]');
  await expect(greet).toBeVisible();
  expect((await greet.boundingBox())!.height).toBeGreaterThanOrEqual(48);
  await expect(sheet).toContainText("Barista · not a player");
  await chiara.screenshot({ path: "test-results/m11-phone-sheet.png" });
});
