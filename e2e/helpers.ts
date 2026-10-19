// Shared browser-test steps. Players join the way a real first-time visitor
// does: the character creator asks for a name (and optionally appearance
// choices), the server creates a guest character, and the game starts.

import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

/**
 * Appearance choices by field path ("hair.style": "afro"), as the creator
 * shows them. Slider fields take a number 0–1. `preset` picks a preset card first.
 */
export type AppearanceChoice = Record<string, string | number>;

/** Makes creator choices on an open creator ("create" or "edit"). */
export async function chooseAppearance(page: Page, appearance: AppearanceChoice): Promise<void> {
  const { preset, ...fields } = appearance;
  if (preset !== undefined) {
    await page.click('#profile-panel .creator-tab[data-tab="presets"]');
    await page.click(`#profile-panel .preset-card[data-preset="${preset}"]`);
  }
  for (const [path, value] of Object.entries(fields)) {
    const section = path.split(".")[0]!;
    await page.click(`#profile-panel .creator-tab[data-tab="${section}"]`);
    if (typeof value === "number") {
      await page.locator(`#profile-panel input[data-field="${path}"]`).fill(String(Math.round(value * 100)));
    } else {
      await page.click(`#profile-panel .picker-group[data-field="${path}"] [data-value="${value}"]`);
    }
  }
}

/** The appearance the creator currently shows (decoded from its data-look attribute). */
export async function creatorLook(page: Page): Promise<any> {
  return JSON.parse((await page.locator("#profile-panel .creator").getAttribute("data-look")) ?? "null");
}

/** Fills in and submits the "Create your character" panel on an already-open page. */
export async function createCharacter(page: Page, name: string, appearance: AppearanceChoice = {}, traits: string[] = []): Promise<void> {
  // Generous timeout: the first page load compiles on demand under Vite and
  // test machines may render WebGL in software.
  await expect(page.locator('#profile-panel[data-mode="create"]')).toBeVisible({ timeout: 15_000 });
  await page.fill("#character-name", name);
  await chooseAppearance(page, appearance);
  if (traits.length > 0) await page.click('#profile-panel .creator-tab[data-tab="personality"]');
  for (const trait of traits) {
    await page.click(`#profile-panel [data-field="traits"] [data-value="${trait}"]`);
  }
  await page.click("#profile-panel button.primary");
  await waitUntilPlaying(page, name);
}

/** A replicated player's appearance, decoded from its look string. */
export const lookOf = (player: { look?: string } | undefined): any => (player?.look ? JSON.parse(player.look) : undefined);

/** Waits until this page's own character is in the world. */
export async function waitUntilPlaying(page: Page, name?: string): Promise<void> {
  try {
    // Generous: the e2e machine renders WebGL in software, several browsers at once.
    await expect(page.locator("#profile-panel")).toBeHidden({ timeout: 30_000 });
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
