// Shared browser-test steps. Players join the way a real visitor does: the
// title screen, then New life (name → look → review → create) or Continue,
// and the server places the character in the world.

import { expect, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { AREAS, GAME_CONFIG, isPositionWalkable } from "@padova/shared";

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

// ── Walking and using objects in the world (shared by the room and university tests) ──

export const players = (page: Page) => page.evaluate(() => (window as any).__padova.players() as { id: string; x: number; z: number; moving: boolean; activity: string; area: string }[]);
export const selfId = (page: Page) => page.evaluate(() => (window as any).__padova.selfId as string);
/** Your own replicated player. */
export const me = async (page: Page) => {
  const id = await selfId(page);
  return (await players(page)).find((p) => p.id === id)!;
};
/** True when a tap at this screen point reaches the 3D view (no UI on top). */
export const reachesGameView = (page: Page, x: number, y: number) => page.evaluate(([sx, sy]) => document.elementFromPoint(sx, sy)?.tagName === "CANVAS", [x, y] as const);

/**
 * Clicks (or taps) open ground near (x, z) and waits until the character stands
 * there. Tries a few nearby spots, because trees, lamps and desks can cover a
 * point from the camera's angle, and skips spots too close to furniture to
 * stand on (the server refuses those, by the shared collision rules).
 */
export async function walkTo(page: Page, x: number, z: number, touch = false): Promise<void> {
  const offsets = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1.5, 1.5], [-1.5, 1.5], [1.5, -1.5], [-1.5, -1.5]] as const;
  // Aim only once the camera has stopped following the character (see afterFrames).
  const screenOf = () => page.evaluate(([px, pz]) => (window as any).__padova.worldToScreen(px, pz) as { x: number; y: number }, [x, z] as const);
  await expect(async () => {
    const first = await screenOf();
    await afterFrames(page);
    const next = await screenOf();
    expect(Math.hypot(next.x - first.x, next.y - first.y), "camera still moving").toBeLessThan(1);
  }).toPass({ timeout: 15_000 });
  for (const [dx, dz] of offsets) {
    const target = { x: x + dx, z: z + dz };
    const point = await page.evaluate(([px, pz]) => (window as any).__padova.worldToScreen(px, pz), [target.x, target.z] as const);
    const pick = await page.evaluate(([sx, sy]) => (window as any).__padova.pickAt(sx, sy), [point.x, point.y] as const);
    if (pick?.kind !== "ground" || !(await reachesGameView(page, point.x, point.y))) continue;
    const layout = AREAS[await page.evaluate(() => (window as any).__padova.area as string)]?.layout;
    if (layout && !isPositionWalkable(layout, pick.point.x, pick.point.z, GAME_CONFIG.playerRadius)) continue;
    if (touch) await page.touchscreen.tap(point.x, point.y);
    else await page.mouse.click(point.x, point.y);
    await expect(async () => {
      const self = await me(page);
      const where = `walking to (${pick.point.x.toFixed(2)}, ${pick.point.z.toFixed(2)}), at (${self.x.toFixed(2)}, ${self.z.toFixed(2)})`;
      expect(Math.hypot(self.x - pick.point.x, self.z - pick.point.z), where).toBeLessThan(0.6);
      expect(self.moving, where).toBe(false);
    }).toPass({ timeout: 20_000 });
    return;
  }
  throw new Error(`no open ground to click near (${x}, ${z})`);
}

/**
 * Screen point of an object once the camera has stopped gliding, checked to be
 * on screen and to pick that object (retried: under software rendering the
 * camera can still be settling after a walk or a door).
 */
export async function objectPoint(page: Page, id: string): Promise<{ x: number; y: number }> {
  const read = () => page.evaluate((target) => (window as any).__padova.targetScreenPoint("object", target), id);
  let aim = { x: 0, y: 0 };
  await expect(async () => {
    const first = await read();
    await afterFrames(page);
    const point = await read();
    expect(Math.hypot(point.x - first.x, point.y - first.y), `${id} still moving on screen`).toBeLessThan(1);
    expect(point.visible, `${id} should be on screen`).toBe(true);
    aim = { x: point.x, y: point.y + 4 };
    expect(await page.evaluate(([x, y]) => (window as any).__padova.pickAt(x, y), [aim.x, aim.y] as const)).toMatchObject({ kind: "object", id });
    expect(await reachesGameView(page, aim.x, aim.y)).toBe(true);
  }).toPass({ timeout: 15_000 });
  return aim;
}

/** Clicks (or taps) an object until its menu (desktop) or sheet (touch) opens; returns it. */
export async function openObjectMenu(page: Page, id: string, touch = false): Promise<Locator> {
  const menu = touch ? page.locator("#action-sheet") : page.locator("#action-menu");
  await expect(async () => {
    const aim = await objectPoint(page, id);
    if (touch) await page.touchscreen.tap(aim.x, aim.y);
    else await page.mouse.click(aim.x, aim.y);
    await expect(menu).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  return menu;
}

/** Clicks (or taps) an object until its menu opens, then chooses an option. */
export async function useObject(page: Page, id: string, action: string, touch = false): Promise<void> {
  const menu = await openObjectMenu(page, id, touch);
  const option = menu.locator(`[data-action="${action}"]`);
  if (touch) await option.tap();
  else await option.click();
}
