// Shared browser-test steps. Players join the way a real visitor does: the
// title screen, then New life (name → look → review → create) or Continue,
// and the server places the character in the world.

import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

/**
 * Appearance choices by field path ("hair.style": "afro"), as the creator
 * shows them. Slider fields take a number 0–1. `preset` picks a starting look first.
 */
export type AppearanceChoice = Record<string, string | number>;

/** The creator category (tab) that shows a field (shared/src/appearance/categories.ts). */
export function categoryOf(path: string): string {
  const [section, field] = path.split(".");
  if (section === "skin") return "appearance";
  if (section === "outfit") return ["headwear", "headwearColour", "glasses"].includes(field!) ? "accessories" : "clothing";
  return section!;
}

/** Makes creator choices on an open creator ("create" or "edit"). */
export async function chooseAppearance(page: Page, appearance: AppearanceChoice): Promise<void> {
  const { preset, ...fields } = appearance;
  if (preset !== undefined) {
    await page.click('#screens .creator-tab[data-tab="appearance"]');
    await page.click(`#screens .preset-card[data-preset="${preset}"]`);
  }
  for (const [path, value] of Object.entries(fields)) {
    await page.click(`#screens .creator-tab[data-tab="${categoryOf(path)}"]`);
    if (typeof value === "number") {
      await page.locator(`#screens input[data-field="${path}"]`).fill(String(Math.round(value * 100)));
    } else {
      await page.click(`#screens .picker-group[data-field="${path}"] [data-value="${value}"]`);
    }
  }
}

/** The appearance the creator currently shows (decoded from its data-look attribute). */
export async function creatorLook(page: Page): Promise<any> {
  return JSON.parse((await page.locator("#screens .creator").getAttribute("data-look")) ?? "null");
}

/** Waits until the title screen has this profile's characters from the server. */
export async function waitForTitle(page: Page, timeoutMs = 30_000): Promise<void> {
  // Generous timeout: the first page load compiles on demand under Vite and
  // test machines may render WebGL in software.
  await page.waitForFunction(() => (window as any).__flow?.lobby().status === "ready" && (window as any).__flow.screen() === "title", null, { timeout: timeoutMs });
}

/**
 * New life from the title screen: name (and traits) → look → review →
 * "Begin life in Padova", then waits until the character is in the world.
 */
export async function createCharacter(page: Page, name: string, appearance: AppearanceChoice = {}, traits: string[] = []): Promise<void> {
  await waitForTitle(page);
  await page.click('#screens [data-action="new-life"]');
  await page.fill("#character-name", name);
  for (const trait of traits) await page.click(`#screens [data-field="traits"] [data-value="${trait}"]`);
  await page.click('#screens [data-action="setup-next"]');
  await expect(page.locator('#screens .creator[data-mode="create"]')).toBeVisible({ timeout: 20_000 });
  await chooseAppearance(page, appearance);
  await page.click('#screens [data-action="creator-review"]');
  await page.click('#screens [data-action="create-character"]');
  await waitUntilPlaying(page, name);
}

/** From the title screen, Continue with the most recently played character. */
export async function continueFromTitle(page: Page, name?: string): Promise<void> {
  await waitForTitle(page);
  await page.click('#screens [data-action="continue"]');
  await waitUntilPlaying(page, name);
}

/** A replicated player's appearance, decoded from its look string. */
export const lookOf = (player: { look?: string } | undefined): any => (player?.look ? JSON.parse(player.look) : undefined);

/** Waits until this page's own character is in the world. */
export async function waitUntilPlaying(page: Page, name?: string, timeoutMs = 60_000): Promise<void> {
  try {
    // Generous: the e2e machine renders WebGL in software, several browsers at
    // once, and the entering screen waits for the world's first frame.
    await expect(page.locator("#screens")).toBeHidden({ timeout: timeoutMs });
  } catch (error) {
    const shown = await page.locator("#screens").innerText().catch(() => "");
    throw new Error(`${name ?? "player"} did not get into the game (screen says: "${shown}")`, { cause: error });
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

/**
 * Waits until the page has drawn `count` more frames. Use this, not a fixed
 * delay, between two reads of a screen point: under software rendering (most
 * of all phone emulation) one frame can take longer than 250 ms, so two reads
 * a fixed time apart can fall in the same frame while the camera still moves.
 */
export async function afterFrames(page: Page, count = 3): Promise<void> {
  await page.evaluate(
    (n) => new Promise<void>((resolve) => {
      let frames = 0;
      const step = () => (++frames >= n ? resolve() : requestAnimationFrame(step));
      requestAnimationFrame(step);
    }),
    count,
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
