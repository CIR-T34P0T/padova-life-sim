// Shared browser-test steps. Players join the way a real first-time visitor
// does: the profile panel asks for a name (and optionally appearance choices),
// the server creates a guest character, and the game starts.

import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

export type AppearanceChoice = Partial<Record<"preset" | "skinTone" | "hairStyle" | "hairColour" | "eyeColour" | "outfit", string>>;

/** Fills in and submits the "Create your character" panel on an already-open page. */
export async function createCharacter(page: Page, name: string, appearance: AppearanceChoice = {}): Promise<void> {
  // Generous timeout: the first page load compiles on demand under Vite and
  // test machines may render WebGL in software.
  await expect(page.locator('#profile-panel[data-mode="create"]')).toBeVisible({ timeout: 15_000 });
  await page.fill("#character-name", name);
  for (const [field, value] of Object.entries(appearance)) {
    await page.click(`#profile-panel .picker-group[data-field="${field}"] [data-value="${value}"]`);
  }
  await page.click("#profile-panel button.primary");
  await waitUntilPlaying(page, name);
}

/** Waits until this page's own character is in the world. */
export async function waitUntilPlaying(page: Page, name?: string): Promise<void> {
  try {
    await expect(page.locator("#profile-panel")).toBeHidden({ timeout: 15_000 });
  } catch (error) {
    const shown = await page.locator("#profile-panel").innerText().catch(() => "");
    throw new Error(`${name ?? "player"} did not get into the game (panel says: "${shown}")`, { cause: error });
  }
  await page.waitForFunction(() => {
    const game = (window as any).__padova;
    return game?.status === "connected" && game.players().some((p: { id: string }) => p.id === game.selfId);
  });
  // Let the camera render a few frames following the new character before a
  // test computes screen positions from it.
  await page.evaluate(
    () => new Promise<void>((resolve) => {
      let frames = 0;
      const step = () => (++frames >= 5 ? resolve() : requestAnimationFrame(step));
      requestAnimationFrame(step);
    }),
  );
}

/** Opens a new browser context and creates a fresh character in it. */
export async function joinAs(
  browser: Browser,
  name: string,
  contextOptions: Parameters<Browser["newContext"]>[0] = {},
  appearance: AppearanceChoice = {},
): Promise<{ context: BrowserContext; page: Page; id: string }> {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  page.on("pageerror", (error) => console.error(`[${name}] page error:`, error.message));
  await page.goto("/");
  await createCharacter(page, name, appearance);
  const id = await page.evaluate(() => (window as any).__padova.selfId as string);
  return { context, page, id };
}
