// Title screen milestone in real browsers against the real server: the
// title menu, Settings and Credits, New life (name → look → review →
// enter), Continue, Manage characters (edit from the title screen, cancel,
// delete), editing in the world without touching needs / money / skills,
// a network drop and a reload, other players seeing the look, and the
// screens on a phone in portrait and landscape (Chromium mobile emulation,
// not a physical device).

import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { chooseAppearance, continueFromTitle, createCharacter, creatorLook, lookOf, waitForTitle, waitUntilPlaying } from "./helpers.ts";

const openContexts: BrowserContext[] = [];
test.afterEach(async () => {
  await Promise.all(openContexts.splice(0).map((context) => context.close().catch(() => undefined)));
});

async function open(browser: Browser, options: Parameters<Browser["newContext"]>[0] = {}): Promise<Page> {
  const context = await browser.newContext(options);
  openContexts.push(context);
  const page = await context.newPage();
  page.on("pageerror", (error) => console.error("page error:", error.message));
  await page.goto("/");
  await waitForTitle(page);
  return page;
}

const screen = (page: Page) => page.evaluate(() => (window as any).__flow.screen() as string);
const lobby = (page: Page) => page.evaluate(() => (window as any).__flow.lobby());
const self = (page: Page) => page.evaluate(() => (window as any).__padova.players().find((p: any) => p.id === (window as any).__padova.selfId));
const life = (page: Page) => page.evaluate(() => (window as any).__padova.life());

/** In the world: character panel → "Back to title". */
async function backToTitle(page: Page): Promise<void> {
  await page.click("#me-chip");
  await page.click('#character-panel [data-action="leave-to-title"]');
  await waitForTitle(page);
  expect(await page.evaluate(() => (window as any).__padova.inWorld)).toBe(false);
}

/** No horizontal scrolling, and every element matching `selector` lies inside the viewport. */
async function expectInside(page: Page, selector: string): Promise<void> {
  // Measure after the screen's short slide-in, not during it.
  await page.waitForFunction(() => !document.querySelector(".screen.is-entering"));
  const viewport = page.viewportSize()!;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
  for (const box of await page.locator(selector).evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON()))) {
    expect(box.left, selector).toBeGreaterThanOrEqual(-1);
    expect(box.right, selector).toBeLessThanOrEqual(viewport.width + 1);
    expect(box.bottom, selector).toBeLessThanOrEqual(viewport.height + 1);
  }
}

/** Dispatches pointer events on the preview like a finger (or two) would. */
async function touchDrag(page: Page, from: { x: number; y: number }[], to: { x: number; y: number }[]): Promise<void> {
  await page.evaluate(
    ({ from, to }) => {
      const canvas = document.querySelector<HTMLCanvasElement>("#screens .creator-canvas")!;
      canvas.setPointerCapture = () => undefined; // synthetic pointers can't be captured
      const fire = (type: string, id: number, p: { x: number; y: number }) =>
        canvas.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: "touch", clientX: p.x, clientY: p.y, bubbles: true }));
      from.forEach((p, i) => fire("pointerdown", 10 + i, p));
      for (let step = 1; step <= 8; step++) {
        from.forEach((p, i) => fire("pointermove", 10 + i, { x: p.x + ((to[i]!.x - p.x) * step) / 8, y: p.y + ((to[i]!.y - p.y) * step) / 8 }));
      }
      to.forEach((p, i) => fire("pointerup", 10 + i, p));
    },
    { from, to },
  );
}

test("title menu, settings that persist, credits, and a new life through name, look and review", async ({ browser }) => {
  test.setTimeout(150_000);
  const page = await open(browser, { viewport: { width: 1280, height: 800 } });
  await expect(page.locator("#screens .menu-item")).toHaveText([/New life/, /Continue/, /Manage characters/, /Settings/, /Credits/]);
  await expect(page.locator('#screens [data-action="continue"]')).toBeDisabled();
  await expect(page.locator('#screens [data-action="continue"]')).toContainText("No saved life yet");
  await expect(page.locator("#screens .title-foot")).toContainText("Not affiliated");
  await page.screenshot({ path: "test-results/title-desktop.png" });

  // Settings are stored in this browser and apply right away.
  await page.click('#screens [data-action="settings"]');
  await page.click('#screens [data-setting="motion"] [data-value="reduced"]');
  await page.click('#screens [data-setting="cameraSpeed"] [data-value="fast"]');
  await page.click('#screens [data-setting="hints"] [data-value="hide"]');
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
  await page.click('#screens [data-setting="graphics"] [data-value="performance"]');
  await expect(page.locator("#screens .settings-status")).toContainText("after reloading");
  await page.reload();
  await waitForTitle(page);
  await page.click('#screens [data-action="settings"]');
  await expect(page.locator('#screens [data-setting="cameraSpeed"] [data-value="fast"]')).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("html")).toHaveAttribute("data-hints", "hide");
  expect(await page.evaluate(() => (window as any).__padova.quality)).toBe("low"); // "Performance" took effect after the reload
  await page.keyboard.press("Escape");
  await expect.poll(() => screen(page)).toBe("title");

  await page.click('#screens [data-action="credits"]');
  await expect(page.locator("#screens .credits-body")).toContainText("Dela Gothic One");
  await expect(page.locator("#screens .credits-body")).toContainText("Not affiliated with or endorsed by the University of Padua");
  await page.click('#screens [data-action="back"]');

  // Step 1: a name is required; personality is optional and limited to two.
  await page.click('#screens [data-action="new-life"]');
  await page.click('#screens [data-action="setup-next"]');
  await expect(page.locator("#screens .form-error")).toContainText("Please enter a name");
  await page.fill("#character-name", "Noemi");
  await page.click('#screens [data-field="traits"] [data-value="organised"]');
  await page.click('#screens [data-field="traits"] [data-value="creative"]');
  await expect(page.locator('#screens [data-field="traits"] [data-value="sociable"]')).toBeDisabled();
  await page.click('#screens [data-action="setup-next"]');

  // Step 2: the look. Going back to the name keeps both.
  await expect(page.locator('#screens .creator[data-mode="create"]')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("#screens .creator-tab")).toHaveText(["Appearance", "Face", "Hair", "Body", "Clothing", "Accessories"]);
  await chooseAppearance(page, { "hair.style": "afro", "outfit.glasses": "round" });
  await page.click('#screens [data-action="creator-back"]');
  await expect(page.locator("#character-name")).toHaveValue("Noemi");
  await page.click('#screens [data-action="setup-next"]');
  await expect.poll(async () => (await creatorLook(page)).hair.style).toBe("afro");

  // Step 3: review, jump back to one category, review again, begin.
  await page.click('#screens [data-action="creator-review"]');
  await expect(page.locator("#screens .review-name")).toHaveText("Noemi");
  await expect(page.locator("#screens .review-traits")).toContainText("Organised");
  await expect(page.locator('#screens .review-line[data-category="hair"]')).toContainText("Rounded afro");
  await expect(page.locator('#screens .review-line[data-category="accessories"]')).toContainText("round");
  await page.click('#screens [data-action="change-hair"]');
  await expect(page.locator('#screens .creator-tab[data-tab="hair"]')).toHaveAttribute("aria-selected", "true");
  await page.click('#screens [data-action="creator-review"]');
  await page.click('#screens [data-action="create-character"]');
  await waitUntilPlaying(page, "Noemi");
  expect(lookOf(await self(page))).toMatchObject({ hair: { style: "afro" }, outfit: { glasses: "round" } });
  await expect.poll(async () => [...((await life(page))?.traits ?? [])].sort()).toEqual(["creative", "organised"]);
  await expect(page.locator(".help")).toBeHidden(); // "Controls reminder: Hide"
});

test("returning players: Continue, managing lives, editing from the title screen, cancelling and deleting", async ({ browser }) => {
  test.setTimeout(240_000);
  const page = await open(browser, { viewport: { width: 1280, height: 800 } });
  await createCharacter(page, "Rosa", { preset: "box-braids" });
  await backToTitle(page);
  await expect(page.locator('#screens [data-action="continue"]')).toContainText("as Rosa");
  await expect(page.locator("#screens .title-card-name")).toHaveText("Rosa");
  await expect.poll(() => page.locator("#screens .title-card .portrait[data-state='ready']").count(), { timeout: 30_000 }).toBe(1);

  // A second life from the character list.
  await page.click('#screens [data-action="manage"]');
  await expect(page.locator("#screens .manage-count")).toHaveText("1 of 3 lives");
  await page.click('#screens .life-card.is-new');
  await page.fill("#character-name", "Teo");
  await page.click('#screens [data-action="setup-next"]');
  await page.click('#screens [data-action="creator-review"]');
  await page.click('#screens [data-action="create-character"]');
  await waitUntilPlaying(page, "Teo");
  await backToTitle(page);
  await expect(page.locator('#screens [data-action="continue"]')).toContainText("as Teo"); // most recently played
  await page.click('#screens [data-action="manage"]');
  await expect(page.locator("#screens .life-name")).toHaveText(["Teo", "Rosa"]);
  await page.screenshot({ path: "test-results/title-manage.png" });

  // Edit Rosa from the title screen, then cancel: asked first, nothing changes.
  const rosaBefore = (await lobby(page)).characters.find((c: any) => c.displayName === "Rosa").look;
  const rosaCard = page.locator("#screens .life-card", { hasText: "Rosa" });
  await rosaCard.locator('[data-action="edit-look"]').click();
  await expect(page.locator('#screens .creator[data-mode="edit"]')).toBeVisible();
  await chooseAppearance(page, { "hair.colour": "silver" });
  await page.click('#screens [data-action="creator-cancel"]');
  await expect(page.locator(".ui-dialog")).toContainText("Discard your changes?");
  await page.click('.ui-dialog [data-action="dialog-cancel"]'); // keep editing
  await expect(page.locator('#screens .creator[data-mode="edit"]')).toBeVisible();
  await page.click('#screens [data-action="creator-cancel"]');
  await page.click('.ui-dialog [data-action="dialog-confirm"]');
  await expect.poll(() => screen(page)).toBe("manage");
  expect((await lobby(page)).characters.find((c: any) => c.displayName === "Rosa").look).toBe(rosaBefore);

  // Edit again and save: confirmation on the review step.
  await rosaCard.locator('[data-action="edit-look"]').click();
  await chooseAppearance(page, { "hair.colour": "silver" });
  await page.click('#screens [data-action="creator-review"]');
  await expect(page.locator("#screens .review-changes")).toHaveText("Changes to save: Hair.");
  await page.click('#screens [data-action="save-look"]');
  await expect(page.locator("#screens .manage-status")).toHaveText("Look saved for Rosa.");
  await expect.poll(async () => JSON.parse((await lobby(page)).characters.find((c: any) => c.displayName === "Rosa").look).hair.colour).toBe("silver");

  // Delete Teo: the name must be typed.
  await page.locator("#screens .life-card", { hasText: "Teo" }).locator('[data-action="delete"]').click();
  await page.fill(".ui-dialog .text-field", "Rosa");
  await expect(page.locator('.ui-dialog [data-action="dialog-confirm"]')).toBeDisabled();
  await page.fill(".ui-dialog .text-field", " teo ");
  await page.click('.ui-dialog [data-action="dialog-confirm"]');
  await expect(page.locator("#screens .manage-status")).toHaveText("Teo was deleted.");
  await expect(page.locator("#screens .life-name")).toHaveText(["Rosa"]);

  // Play Rosa; another player sees the saved look.
  await page.locator("#screens .life-card", { hasText: "Rosa" }).locator('[data-action="play"]').click();
  await waitUntilPlaying(page, "Rosa");
  expect(lookOf(await self(page))).toMatchObject({ hair: { style: "box-braids", colour: "silver" } });
  const observer = await open(browser, { viewport: { width: 900, height: 640 } });
  await createCharacter(observer, "Watcher");
  await expect.poll(async () => lookOf((await observer.evaluate(() => (window as any).__padova.players())).find((p: any) => p.name === "Rosa"))?.hair).toMatchObject({ style: "box-braids", colour: "silver" });
});

test("editing the look in the world keeps needs, money and skills; cancel changes nothing; drops and reloads keep it", async ({ browser }) => {
  test.setTimeout(180_000);
  const page = await open(browser, { viewport: { width: 1280, height: 800 } });
  await createCharacter(page, "Vale", {}, ["ambitious"]);
  await expect.poll(() => life(page)).not.toBeNull();
  const before = await life(page);
  const lookBefore = lookOf(await self(page));

  // Cancel: no request is sent, the look stays.
  await page.click("#me-chip");
  await page.click('#character-panel [data-action="edit-appearance"]');
  await expect(page.locator('#screens .creator[data-mode="edit"]')).toBeVisible();
  await chooseAppearance(page, { "hair.style": "twists" });
  await page.click('#screens [data-action="creator-cancel"]');
  await page.click('.ui-dialog [data-action="dialog-confirm"]');
  await expect(page.locator("#screens")).toBeHidden();
  await page.waitForTimeout(500);
  expect(lookOf(await self(page))).toEqual(lookBefore);

  // Save: only the look changes.
  await page.click("#me-chip");
  await page.click('#character-panel [data-action="edit-appearance"]');
  await chooseAppearance(page, { "hair.style": "twists", "outfit.headwear": "beanie" });
  await page.click('#screens [data-action="creator-review"]');
  await page.click('#screens [data-action="save-look"]');
  await expect(page.locator("#screens")).toBeHidden();
  await expect(page.locator("#toast")).toHaveText("Look saved.");
  await expect.poll(async () => lookOf(await self(page))?.hair.style).toBe("twists");
  const after = await life(page);
  expect(after.money.balanceCents).toBe(before.money.balanceCents);
  expect(after.money.recent.length).toBe(before.money.recent.length);
  expect(after.skills).toEqual(before.skills);
  expect(after.traits).toEqual(["ambitious"]);
  for (const need of Object.keys(before.needs)) expect(Math.abs(after.needs[need] - before.needs[need]), need).toBeLessThan(3);

  // A brief network drop: the client reconnects into the same character.
  const selfId = await page.evaluate(() => (window as any).__padova.selfId);
  const statusesBefore = await page.evaluate(() => (window as any).__padova.statusLog().length);
  await page.evaluate(() => (window as any).__padova.simulateDrop());
  await expect.poll(() => page.evaluate((from) => (window as any).__padova.statusLog().slice(from), statusesBefore), { timeout: 20_000 }).toEqual(["reconnecting", "connected"]);
  expect(await page.evaluate(() => (window as any).__padova.selfId)).toBe(selfId);
  expect(await page.evaluate(() => (window as any).__padova.inWorld)).toBe(true);
  expect(lookOf(await self(page))).toMatchObject({ hair: { style: "twists" }, outfit: { headwear: "beanie" } });

  // A reload: title screen, Continue, same look.
  await page.reload();
  await continueFromTitle(page, "Vale");
  expect(lookOf(await self(page))).toMatchObject({ hair: { style: "twists" }, outfit: { headwear: "beanie" } });
});

test("phone portrait and landscape: the screens fit, touch turns and pinches the preview, creating works", async ({ browser }) => {
  test.setTimeout(240_000);
  const page = await open(browser, { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await expectInside(page, "#screens .menu-item");
  for (const height of await page.locator("#screens .menu-item").evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height))) {
    expect(height).toBeGreaterThanOrEqual(44);
  }
  await page.screenshot({ path: "test-results/title-phone.png" });
  await page.locator('#screens [data-action="new-life"]').tap();
  await page.fill("#character-name", "Lin");
  await page.locator('#screens [data-field="traits"] [data-value="sociable"]').tap();
  await expectInside(page, '#screens [data-action="setup-next"]');
  await page.locator('#screens [data-action="setup-next"]').tap();
  await expect(page.locator('#screens .creator[data-mode="create"]')).toBeVisible({ timeout: 20_000 });
  await page.waitForFunction(() => (window as any).__creator);

  // All six categories are on screen and the preview sits above them.
  await expectInside(page, "#screens .creator-tab");
  const canvas = (await page.locator("#screens .creator-canvas").boundingBox())!;
  const tabs = (await page.locator("#screens .creator-tabs").boundingBox())!;
  expect(canvas.height).toBeGreaterThan(200);
  expect(tabs.y).toBeGreaterThan(canvas.y + canvas.height - 1);
  await expectInside(page, "#screens .creator-footer .ui-button");

  // One finger turns the character; two fingers zoom.
  const camera = () => page.evaluate(() => (window as any).__creator.camera() as { yaw: number; zoom: number });
  const start = await camera();
  const cx = canvas.x + canvas.width / 2;
  const cy = canvas.y + canvas.height / 3;
  await touchDrag(page, [{ x: cx - 60, y: cy }], [{ x: cx + 60, y: cy }]);
  expect((await camera()).yaw).toBeGreaterThan(start.yaw + 0.5);
  await touchDrag(page, [{ x: cx - 20, y: cy }, { x: cx + 20, y: cy }], [{ x: cx - 90, y: cy }, { x: cx + 90, y: cy }]);
  expect((await camera()).zoom).toBeGreaterThan(start.zoom + 0.5);

  await page.locator('#screens .creator-tab[data-tab="hair"]').tap();
  await page.locator('#screens [data-field="hair.style"] [data-value="locs"]').tap();
  await page.screenshot({ path: "test-results/title-phone-creator.png" });
  await page.locator('#screens [data-action="creator-review"]').tap();
  await expectInside(page, '#screens [data-action="create-character"]');
  await page.locator('#screens [data-action="create-character"]').tap();
  await waitUntilPlaying(page, "Lin");
  expect(lookOf(await self(page))).toMatchObject({ hair: { style: "locs" } });

  // Landscape: the title menu and the creator still fit.
  await page.setViewportSize({ width: 844, height: 390 });
  await page.locator("#me-chip").tap();
  await page.locator('#character-panel [data-action="leave-to-title"]').tap();
  await waitForTitle(page);
  await expectInside(page, "#screens .menu-item");
  await page.screenshot({ path: "test-results/title-phone-landscape.png" });
  await page.locator('#screens [data-action="manage"]').tap();
  await page.locator('#screens [data-action="edit-look"]').tap();
  await expect(page.locator('#screens .creator[data-mode="edit"]')).toBeVisible();
  const preview = (await page.locator("#screens .creator-preview").boundingBox())!;
  const side = (await page.locator("#screens .creator-side").boundingBox())!;
  expect(side.x).toBeGreaterThanOrEqual(preview.x + preview.width - 1); // side by side
  await expectInside(page, "#screens .creator-tab");
  await expectInside(page, "#screens .creator-footer .ui-button");
  await page.screenshot({ path: "test-results/title-phone-landscape-creator.png" });
  await page.locator('#screens [data-action="creator-cancel"]').tap(); // nothing changed: no question asked
  await expect.poll(() => screen(page)).toBe("manage");
  await page.locator('#screens [data-action="play"]').tap();
  await waitUntilPlaying(page, "Lin");
});
