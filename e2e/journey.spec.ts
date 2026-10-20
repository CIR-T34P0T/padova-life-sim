// The whole player journey in one run, with two clients (integration audit,
// 2026-10-20): launch → create and customise → enter the world → walk →
// actions that change needs, mood and skills → saved → reload and a network
// drop keep everything → a second player sees the same look, movement and
// actions → an appearance change reaches them → leaving and coming back
// (same guest identity, new browser context) gives exactly one character
// with the same state. Throughout, no page errors, failed requests or
// missing files are allowed.

import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { chooseAppearance, continueFromTitle, createCharacter, lookOf, waitForTitle } from "./helpers.ts";

interface DebugPlayer {
  id: string;
  name: string;
  x: number;
  z: number;
  moving: boolean;
  activity: string;
  seatId: string;
  look: string;
}

interface LifeView {
  needs: Record<"hunger" | "energy" | "hygiene" | "social" | "fun", number>;
  mood: { reasons: { label: string }[] };
  skills: Record<string, { xp: number; level: number }>;
  traits: string[];
  money: { balanceCents: number; recent: { category: string; description: string; amountCents: number }[] };
}

const openContexts: BrowserContext[] = [];
test.afterEach(async () => {
  await Promise.all(openContexts.splice(0).map((context) => context.close().catch(() => undefined)));
});

/** Records anything that would mean a broken page: errors, failed requests, missing files. */
function watchHealth(page: Page, name: string, problems: string[]): void {
  page.on("pageerror", (error) => problems.push(`${name}: page error: ${error.message}`));
  page.on("response", (response) => {
    if (response.status() >= 400) problems.push(`${name}: HTTP ${response.status()} for ${response.url()}`);
  });
  page.on("requestfailed", (request) => {
    const reason = request.failure()?.errorText ?? "";
    // Requests still in flight when a page reloads or closes are aborted; that is normal.
    if (!reason.includes("ERR_ABORTED")) problems.push(`${name}: request failed (${reason}) for ${request.url()}`);
  });
}

const self = (page: Page): Promise<DebugPlayer> =>
  page.evaluate(() => {
    const game = (window as any).__padova;
    return game.players().find((p: DebugPlayer) => p.id === game.selfId);
  });
const seen = async (observer: Page, name: string): Promise<DebugPlayer[]> =>
  (await observer.evaluate(() => (window as any).__padova.players() as DebugPlayer[])).filter((p) => p.name === name);
const life = (page: Page): Promise<LifeView> => page.evaluate(() => (window as any).__padova.life());

/**
 * The player's life data once it has stopped changing. The server sends
 * `life` at most every 500 ms, so right after a walk the client can still be
 * missing the last fitness XP; a snapshot taken then is stale, not wrong.
 */
async function settledLife(page: Page): Promise<LifeView> {
  let last = JSON.stringify((await life(page)).skills);
  await expect.poll(async () => {
    const next = JSON.stringify((await life(page)).skills);
    const still = next === last;
    last = next;
    return still;
  }, { timeout: 10_000, intervals: [700] }).toBe(true);
  return life(page);
}

/**
 * Money is unchanged except for daily allowances paid in between (a new game
 * day can start during this test). `recent` lists the newest rows first.
 */
function expectSameMoney(after: LifeView, before: LifeView): void {
  const added = after.money.recent.slice(0, Math.max(0, after.money.recent.length - before.money.recent.length));
  expect(added.every((row) => row.category === "allowance"), JSON.stringify(added)).toBe(true);
  expect(after.money.balanceCents - before.money.balanceCents).toBe(added.reduce((sum, row) => sum + row.amountCents, 0));
}

/** Waits until a fixed world point stops moving on screen (the camera glides after the character). */
async function cameraSettled(page: Page): Promise<void> {
  const read = () => page.evaluate(() => (window as any).__padova.worldToScreen(0, 0));
  let last = await read();
  await expect.poll(async () => {
    const next = await read();
    const still = Math.hypot(next.x - last.x, next.y - last.y) < 1;
    last = next;
    return still;
  }, { timeout: 10_000, intervals: [250] }).toBe(true);
}

/** Walks to the first ground point that is on screen and not hidden, and waits until the character stands there. */
async function walkToAny(page: Page, points: readonly (readonly [number, number])[]): Promise<{ x: number; z: number }> {
  await cameraSettled(page);
  const view = page.viewportSize()!;
  for (const [x, z] of points) {
    const { point, pick } = await page.evaluate(([px, pz]) => {
      const g = (window as any).__padova;
      const p = g.worldToScreen(px, pz);
      return { point: p, pick: g.pickAt(p.x, p.y) };
    }, [x, z] as const);
    const onScreen = point.x > 8 && point.x < view.width - 8 && point.y > 8 && point.y < view.height - 8;
    if (!onScreen || pick?.kind !== "ground") continue;
    await page.mouse.click(point.x, point.y);
    await expect.poll(async () => {
      const me = await self(page);
      return Math.hypot(me.x - x, me.z - z) < 0.5 && !me.moving;
    }, { timeout: 30_000 }).toBe(true);
    return { x, z };
  }
  throw new Error(`none of ${JSON.stringify(points)} could be tapped`);
}

/** Taps an object (checked to be on screen and to pick that object) and chooses an action from its menu. */
async function useObject(page: Page, id: string, action: string): Promise<void> {
  await cameraSettled(page);
  const point = await page.evaluate((i) => (window as any).__padova.targetScreenPoint("object", i), id);
  expect(point?.visible, `${id} should be on screen`).toBe(true);
  const aim = { x: point.x, y: point.y + 4 };
  expect(await page.evaluate(([x, y]) => (window as any).__padova.pickAt(x, y), [aim.x, aim.y] as const)).toMatchObject({ kind: "object", id });
  await page.mouse.click(aim.x, aim.y);
  await page.click(`#action-menu [data-action="${action}"]`);
}

test("the full player journey: create, play, save, reload, a second player, a new look, leave and return", async ({ browser }) => {
  test.setTimeout(600_000); // two software-rendered browsers, the creator twice, timed actions, reloads
  const problems: string[] = [];

  // 1. Launch.
  const aliceContext = await browser.newContext();
  openContexts.push(aliceContext);
  const alice = await aliceContext.newPage();
  watchHealth(alice, "Lucia", problems);
  await alice.goto("/");
  await waitForTitle(alice);
  await expect(alice.locator("#screens .title-menu")).toContainText("New life");

  // 2–3. Create and customise a character, save it and enter the world.
  const choices = { "skin.tone": 0.86, "hair.style": "box-braids", "hair.colour": "dark-brown", "face.eyeShape": "hooded", "outfit.top": "hoodie", "outfit.topColour": "navy" };
  await createCharacter(alice, "Lucia", choices, ["organised"]);
  const created = lookOf(await self(alice));
  expect(created).toMatchObject({ skin: { tone: 0.86 }, hair: { style: "box-braids", colour: "dark-brown" }, face: { eyeShape: "hooded" }, outfit: { top: "hoodie", topColour: "navy" } });
  await expect.poll(async () => (await life(alice))?.traits).toEqual(["organised"]);
  const start = await life(alice);

  // 8 (early, so it can watch the rest). A second client joins and sees Lucia exactly as saved.
  const brunoContext = await browser.newContext();
  openContexts.push(brunoContext);
  const bruno = await brunoContext.newPage();
  watchHealth(bruno, "Marco", problems);
  await bruno.goto("/");
  await createCharacter(bruno, "Marco");
  await expect.poll(async () => (await seen(bruno, "Lucia")).length).toBe(1);
  expect(lookOf((await seen(bruno, "Lucia"))[0])).toEqual(created);

  // 4. Move: Bruno sees Lucia arrive where she walked.
  const spot = await walkToAny(alice, [[4, 3], [5, 4], [3.5, 3.5], [6, 4]]);
  await expect.poll(async () => {
    const lucia = (await seen(bruno, "Lucia"))[0]!;
    return Math.hypot(lucia.x - spot.x, lucia.z - spot.z);
  }, { timeout: 10_000 }).toBeLessThan(0.3);

  // 5. Actions that change needs, mood and skills, seen by the other player.
  await useObject(alice, "fountain", "wash");
  await expect.poll(async () => (await seen(bruno, "Lucia"))[0]?.activity, { timeout: 30_000 }).toBe("washing");
  await expect.poll(async () => (await self(alice)).activity, { timeout: 30_000 }).toBe("idle");
  await expect.poll(async () => (await life(alice)).mood.reasons.map((r) => r.label).join(" "), { timeout: 10_000 }).toContain("Freshened up");
  const washed = await life(alice);
  expect(washed.needs.hygiene).toBeGreaterThan(start.needs.hygiene);

  await useObject(alice, "bench-2", "sketch");
  await expect.poll(async () => (await seen(bruno, "Lucia"))[0]?.activity, { timeout: 30_000 }).toBe("sketching");
  await expect.poll(async () => (await life(alice)).skills.creativity?.xp ?? 0, { timeout: 40_000 }).toBeGreaterThan(0);
  await expect.poll(async () => (await self(alice)).activity, { timeout: 30_000 }).not.toBe("sketching");
  // Stand up by walking away, so the saved position is a plain spot on the ground.
  const rest = await walkToAny(alice, [[5, -4], [4, -3], [6, -3], [3, -4]]);
  const before = await settledLife(alice);
  expect(before.skills.creativity!.xp).toBeGreaterThan(0);

  // 6–7. Saved by the server: a reload brings back the same character and state.
  await alice.reload();
  await waitForTitle(alice);
  await expect(alice.locator('#screens [data-action="continue"]')).toContainText("as Lucia");
  await continueFromTitle(alice, "Lucia after a reload");
  const reloaded = await self(alice);
  expect(Math.hypot(reloaded.x - rest.x, reloaded.z - rest.z)).toBeLessThan(0.3);
  expect(lookOf(reloaded)).toEqual(created);
  await expect.poll(async () => (await life(alice))?.skills.creativity?.xp ?? 0).toBe(before.skills.creativity!.xp);
  const afterReload = await settledLife(alice);
  // Both values in the message: a lower value after the reload would mean lost progress.
  expect(afterReload.skills, `before ${JSON.stringify(before.skills)} after ${JSON.stringify(afterReload.skills)}`).toEqual(before.skills);
  expect(afterReload.traits).toEqual(["organised"]);
  expectSameMoney(afterReload, before);
  for (const need of Object.keys(before.needs) as (keyof LifeView["needs"])[]) {
    expect(Math.abs(afterReload.needs[need] - before.needs[need]), need).toBeLessThan(3);
  }
  expect(afterReload.mood.reasons.map((r) => r.label).join(" ")).toContain("Freshened up");
  // Bruno saw Lucia leave and come back: still exactly one.
  await expect.poll(async () => (await seen(bruno, "Lucia")).length).toBe(1);

  // A brief network drop reconnects into the same character, without a duplicate.
  const selfId = await alice.evaluate(() => (window as any).__padova.selfId);
  const statusesBefore = await alice.evaluate(() => (window as any).__padova.statusLog().length);
  await alice.evaluate(() => (window as any).__padova.simulateDrop());
  await expect.poll(() => alice.evaluate((from) => (window as any).__padova.statusLog().slice(from), statusesBefore), { timeout: 20_000 }).toEqual(["reconnecting", "connected"]);
  expect(await alice.evaluate(() => (window as any).__padova.selfId)).toBe(selfId);
  await expect.poll(async () => (await seen(bruno, "Lucia")).filter((p: any) => p.connected !== false).length).toBe(1);

  // 9. A new look reaches the other player.
  await cameraSettled(alice);
  const me = await alice.evaluate(() => (window as any).__padova.targetScreenPoint("player", (window as any).__padova.selfId));
  await alice.mouse.click(me.x, me.y);
  await alice.click('#action-menu [data-action="edit-appearance"]');
  await expect(alice.locator('#screens .creator[data-mode="edit"]')).toBeVisible({ timeout: 20_000 });
  await chooseAppearance(alice, { "hair.colour": "silver", "outfit.glasses": "round" });
  await alice.click('#screens [data-action="creator-review"]');
  await alice.click('#screens [data-action="save-look"]');
  await expect(alice.locator("#screens")).toBeHidden({ timeout: 20_000 });
  await expect.poll(async () => lookOf((await seen(bruno, "Lucia"))[0])?.hair.colour, { timeout: 15_000 }).toBe("silver");
  const newLook = lookOf((await seen(bruno, "Lucia"))[0]);
  expect(newLook.outfit.glasses).toBe("round");
  expect(newLook.skin).toEqual(created.skin); // only what was changed changed
  const beforeLeaving = await settledLife(alice);
  expect(beforeLeaving.skills, `before ${JSON.stringify(before.skills)} now ${JSON.stringify(beforeLeaving.skills)}`).toEqual(before.skills); // a look change never touches life data
  expectSameMoney(beforeLeaving, before);

  // 10. Leave (close the browser) and come back with the same guest identity in a new context.
  const savedState = await aliceContext.storageState();
  await aliceContext.close();
  await expect.poll(async () => (await seen(bruno, "Lucia")).length, { timeout: 15_000 }).toBe(0);
  const returnContext = await browser.newContext({ storageState: savedState });
  openContexts.push(returnContext);
  const back = await returnContext.newPage();
  watchHealth(back, "Lucia (returning)", problems);
  await back.goto("/");
  await continueFromTitle(back, "Lucia returning");
  await expect.poll(async () => (await seen(bruno, "Lucia")).length).toBe(1);
  expect(lookOf(await self(back))).toEqual(newLook);
  await expect.poll(async () => (await life(back))?.skills.creativity?.xp ?? 0).toBe(before.skills.creativity!.xp);
  const returned = await settledLife(back);
  expect(returned.skills, `before ${JSON.stringify(before.skills)} returned ${JSON.stringify(returned.skills)}`).toEqual(before.skills);
  expectSameMoney(returned, before);
  // The same profile has one life, not a copy made by the return.
  const titleCount = await returnContext.newPage().then(async (other) => {
    await other.goto("/");
    // A third page on a busy test machine (two others are drawing the world): allow longer.
    await waitForTitle(other, 90_000);
    const count = await other.evaluate(() => (window as any).__flow.lobby().characters.length);
    await other.close();
    return count;
  });
  expect(titleCount).toBe(1);
  await back.screenshot({ path: "test-results/journey-returned.png" });

  expect(problems, problems.join("\n")).toEqual([]);
});
