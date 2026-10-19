// M6 character creator and diverse characters in real browsers: every
// option visibly changes the 3D preview (and only the affected part is
// rebuilt), covered choices are labelled instead of pretending to change,
// presets / randomise / undo / compare / look codes work, the creator fits
// a phone, and diverse characters replicate identically to other players.

import { createHash } from "node:crypto";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { chooseAppearance, createCharacter, creatorLook, lookOf, waitForTitle, waitUntilPlaying } from "./helpers.ts";

const openContexts: BrowserContext[] = [];
test.afterEach(async () => {
  await Promise.all(openContexts.splice(0).map((context) => context.close().catch(() => undefined)));
});

/** Title screen → New life → name → the creator (look step). */
async function openCreator(browser: Browser, options: Parameters<Browser["newContext"]>[0] = {}, name = "Tester"): Promise<Page> {
  const context = await browser.newContext(options);
  openContexts.push(context);
  const page = await context.newPage();
  page.on("pageerror", (error) => console.error("page error:", error.message));
  await page.goto("/");
  await waitForTitle(page);
  await page.click('#screens [data-action="new-life"]');
  await page.fill("#character-name", name);
  await page.click('#screens [data-action="setup-next"]');
  await expect(page.locator('#screens .creator[data-mode="create"]')).toBeVisible({ timeout: 20_000 });
  await page.waitForFunction(() => (window as any).__creator);
  await page.evaluate(() => (window as any).__creator.freeze());
  return page;
}

/** Waits for the preview to show the current look (two frames after the last build), then hashes the canvas. */
async function previewHash(page: Page): Promise<string> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let frames = 0;
        const step = () => (++frames >= 3 ? resolve() : requestAnimationFrame(step));
        requestAnimationFrame(step);
      }),
  );
  const png = await page.locator("#screens .creator-canvas").screenshot();
  return createHash("sha1").update(png).digest("hex");
}

const lastRebuilt = (page: Page) => page.locator("#screens .creator").getAttribute("data-rebuilt");

test("every hair style, top and eye shape changes the preview, rebuilding only the affected parts", async ({ browser }) => {
  test.setTimeout(240_000);
  const page = await openCreator(browser);
  await page.click('#screens .creator-tab[data-tab="hair"]');
  const styles = await page.locator('#screens [data-field="hair.style"] [data-value]').evaluateAll((buttons) => buttons.map((b) => (b as HTMLElement).dataset.value!));
  expect(styles.length).toBeGreaterThanOrEqual(17);
  const seen = new Map<string, string>();
  const buildTimes: number[] = [];
  for (const style of styles) {
    await page.click(`#screens [data-field="hair.style"] [data-value="${style}"]`);
    await expect.poll(async () => (await creatorLook(page)).hair.style).toBe(style);
    const hash = await previewHash(page);
    expect(await lastRebuilt(page), `${style} rebuilds only the head`).toBe("head");
    buildTimes.push(Number(await page.locator("#screens .creator").getAttribute("data-build-ms")));
    expect(seen.has(hash), `${style} looks different from ${seen.get(hash)}`).toBe(false);
    seen.set(hash, style);
  }

  await page.click('#screens .creator-tab[data-tab="clothing"]');
  const tops = ["tee", "tank", "shirt", "hoodie", "sweater"];
  const topHashes = new Set<string>();
  for (const top of tops) {
    await page.click(`#screens [data-field="outfit.top"] [data-value="${top}"]`);
    await expect.poll(async () => (await creatorLook(page)).outfit.top).toBe(top);
    topHashes.add(await previewHash(page));
    if (top !== "tee") expect((await lastRebuilt(page))?.split(",")).not.toContain("head");
  }
  expect(topHashes.size).toBe(tops.length);

  await page.click('#screens .creator-tab[data-tab="face"]');
  const eyeHashes = new Set<string>();
  for (const eye of ["round", "almond", "hooded", "monolid", "upturned", "downturned"]) {
    await page.click(`#screens [data-field="face.eyeShape"] [data-value="${eye}"]`);
    await expect.poll(async () => (await creatorLook(page)).face.eyeShape).toBe(eye);
    eyeHashes.add(await previewHash(page));
  }
  expect(eyeHashes.size).toBe(6);
  test.info().annotations.push({ type: "hair rebuild ms (software rendering machine)", description: buildTimes.map((t) => t.toFixed(0)).join(", ") });
});

test("covered choices are kept and labelled, and the preview does not pretend they changed", async ({ browser }) => {
  test.setTimeout(120_000);
  const page = await openCreator(browser);
  await chooseAppearance(page, { "outfit.headwear": "headscarf" });
  await page.click('#screens .creator-tab[data-tab="hair"]');
  const covered = await previewHash(page);
  await page.click('#screens [data-field="hair.style"] [data-value="afro"]');
  await expect(page.locator('#screens [data-field="hair.style"] .hidden-note')).toContainText("Covered by the headscarf");
  expect(await previewHash(page)).toBe(covered); // nothing visible changed, and the UI says why
  expect((await creatorLook(page)).hair.style).toBe("afro"); // but the choice is saved

  await chooseAppearance(page, { "outfit.headwear": "none" });
  await page.click('#screens .creator-tab[data-tab="hair"]');
  await expect(page.locator('#screens [data-field="hair.style"] .hidden-note')).toBeHidden();
  expect(await previewHash(page)).not.toBe(covered);

  // A full outfit covers the separate top and bottom.
  await chooseAppearance(page, { "outfit.full": "jumpsuit" });
  await expect(page.locator('#screens [data-field="outfit.top"] .hidden-note')).toContainText("full outfit");
});

test("presets, randomise, undo, redo, reset, compare and look codes", async ({ browser }) => {
  test.setTimeout(240_000);
  const page = await openCreator(browser);
  const start = await creatorLook(page);

  await page.click('#screens .preset-card[data-preset="locs-beard"]');
  await expect.poll(async () => (await creatorLook(page)).hair.style).toBe("locs");
  expect((await creatorLook(page)).body.frame).toBe("masculine");
  await expect(page.locator('#screens .preset-card[data-preset="locs-beard"]')).toHaveAttribute("aria-pressed", "true");
  // Thumbnails are drawn for the preset cards.
  // Portraits of the starting looks are drawn as they scroll into view: a few at first, the rest on scrolling.
  await expect.poll(async () => page.locator("#screens .preset-thumb[src^='data:image/png']").count(), { timeout: 60_000 }).toBeGreaterThan(2);
  expect(await page.locator("#screens .preset-thumb[src^='data:image/png']").count()).toBeLessThan(17);
  await page.locator("#screens .preset-grid").evaluate((grid) => (grid.scrollLeft = grid.scrollWidth));
  await expect(page.locator("#screens .preset-item").last().locator(".preset-thumb")).toHaveAttribute("src", /^data:image\/png/, { timeout: 60_000 });

  await page.click('#screens [data-action="undo"]');
  await expect.poll(() => creatorLook(page)).toEqual(start);
  await page.click('#screens [data-action="redo"]');
  await expect.poll(async () => (await creatorLook(page)).hair.style).toBe("locs");

  await page.click('#screens [data-action="randomise-all"]');
  await expect.poll(async () => JSON.stringify(await creatorLook(page))).not.toContain('"style":"locs","colour":"black","hairline":"rounded","facial":"full-beard"');
  const randomised = await creatorLook(page);

  await page.click('#screens .creator-tab[data-tab="hair"]');
  await page.click('#screens [data-action="reset-hair"]');
  await expect.poll(async () => (await creatorLook(page)).hair).toEqual(start.hair);
  expect((await creatorLook(page)).outfit).toEqual(randomised.outfit); // other tabs untouched

  // Hold to compare shows the starting look, release shows the current one.
  const compare = page.locator('#screens [data-action="compare"]');
  const box = (await compare.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(page.locator("#screens .creator")).toHaveAttribute("data-showing", "compare");
  await page.mouse.up();
  await expect(page.locator("#screens .creator")).toHaveAttribute("data-showing", "current");

  // Look codes: copy this look, change it, paste the code back.
  const current = await creatorLook(page);
  await page.click('#screens .creator-tab[data-tab="appearance"]');
  await page.click("#screens .look-codes summary");
  await page.click('#screens [data-action="copy-look"]');
  const code = await page.locator("#screens .look-code-input").inputValue();
  expect(code).toMatch(/^PLS1\./);
  await page.click('#screens .preset-card[data-preset="afro-puffs"]');
  await expect.poll(async () => (await creatorLook(page)).hair.style).toBe("afro-puffs");
  await page.fill("#screens .look-code-input", code);
  await page.click('#screens [data-action="use-look-code"]');
  await expect.poll(() => creatorLook(page)).toEqual(current);
  await page.fill("#screens .look-code-input", "PLS1.not-a-real-code");
  await page.click('#screens [data-action="use-look-code"]');
  await expect(page.locator("#screens .creator-status")).toContainText("isn't valid");
});

test("the creator fits a phone: preview on top, controls below, and creating works", async ({ browser }) => {
  test.setTimeout(120_000);
  const page = await openCreator(browser, { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }, "Pia");
  const canvas = (await page.locator("#screens .creator-canvas").boundingBox())!;
  const tabs = (await page.locator("#screens .creator-tabs").boundingBox())!;
  expect(canvas.width).toBeGreaterThan(300);
  expect(canvas.height).toBeGreaterThan(200);
  expect(tabs.y).toBeGreaterThan(canvas.y + canvas.height - 1);
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "test-results/m6-creator-phone.png" });
  await page.locator('#screens .preset-card[data-preset="afro-puffs"]').tap();
  await page.locator('#screens .creator-tab[data-tab="appearance"]').tap();
  await page.locator('#screens .tone-stops [data-value="0.375"]').tap();
  await expect.poll(async () => (await creatorLook(page)).skin.tone).toBe(0.38); // sliders keep two decimals
  await page.locator('#screens [data-action="creator-review"]').tap();
  await page.locator('#screens [data-action="create-character"]').tap();
  await waitUntilPlaying(page, "Pia");
  const me = await page.evaluate(() => (window as any).__padova.players().find((p: any) => p.id === (window as any).__padova.selfId));
  expect(lookOf(me)).toMatchObject({ hair: { style: "afro-puffs" }, skin: { tone: 0.38 } });
});

test("diverse characters replicate identically to other players, within the geometry budget", async ({ browser }) => {
  test.setTimeout(900_000); // four software-rendered browsers on 2 CPUs: each join is slower than the last
  const presets = ["rounded-afro", "box-braids", "headscarf-cardigan", "silver-buzz"];
  const pages: Page[] = [];
  for (const [i, preset] of presets.entries()) {
    const context = await browser.newContext({ viewport: { width: 1000, height: 700 } });
    openContexts.push(context);
    const page = await context.newPage();
    await page.goto("/");
    await createCharacter(page, `P${i}-${preset.slice(0, 8)}`, { preset });
    pages.push(page);
  }
  const observer = pages[0]!;
  await expect.poll(async () => (await observer.evaluate(() => (window as any).__padova.players().length)), { timeout: 30_000 }).toBe(presets.length);
  // Every player sees every other player's exact look.
  const own = await Promise.all(pages.map((page) => page.evaluate(() => (window as any).__padova.players().find((p: any) => p.id === (window as any).__padova.selfId))));
  for (const page of pages) {
    const seen = await page.evaluate(() => (window as any).__padova.players());
    for (const player of own) expect(seen.find((p: any) => p.id === player.id)?.look).toBe(player.look);
  }
  // Geometry budget per character (docs/ASSET_PIPELINE.md): under 30k triangles, at most 14 meshes.
  const stats = await observer.evaluate(() => (window as any).__padova.players().map((p: any) => ({ name: p.name, ...(window as any).__padova.avatarStats(p.id) })));
  for (const s of stats) {
    expect(s.triangles, s.name).toBeLessThan(30_000);
    expect(s.meshes, s.name).toBeLessThanOrEqual(14);
  }
  // Gather everyone near the fountain for a picture (manual visual check).
  for (const [i, page] of pages.entries()) {
    const spot = await page.evaluate((index) => (window as any).__padova.worldToScreen(-3 + index * 1.2, 4), i);
    await page.mouse.click(spot.x, spot.y);
  }
  await observer.waitForTimeout(6000);
  await observer.screenshot({ path: "test-results/m6-diverse-plaza.png" });
  const render = await observer.evaluate(() => (window as any).__padova.renderStats());
  console.log("[m6 perf] avatars:", JSON.stringify(stats), "render:", JSON.stringify(render));
  test.info().annotations.push(
    { type: "avatar stats", description: stats.map((s: any) => `${s.name}: ${Math.round(s.triangles)} tris, ${s.meshes} meshes, ${s.buildMs.toFixed(0)} ms`).join(" | ") },
    { type: "render stats (software rendering)", description: JSON.stringify(render) },
  );
});
