// A place to live (M10) in real browsers against the real server.
// Desktop, two players: renting a room at the student housing's door (a
// dialog with the rooms and their rent), going straight in and out of the
// other player's sight, the room drawn from the server's data, sleeping in
// the bed, furnishing from the home panel (bought through the ledger, drawn
// at once, sat on), putting away, a reload that comes back home with
// everything, going out again, and moving out (the furniture kept). Phone
// (Pixel 7 emulation, not a physical device): the rent dialog and the home
// panel as a bottom sheet, with large touch targets.

import { devices, expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { continueFromTitle, createCharacter, openObjectMenu, players, selfId, useObject, walkTo } from "./helpers.ts";

const DOOR = "housing-door";

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

interface HousingView {
  home: { areaId: string; roomType: string; placements: { furnitureId: string; itemId: string; slot: string }[] } | null;
  storage: { furnitureId: string; itemId: string }[];
  panel: { open: boolean; mode: string; waiting: boolean; text: string };
}
const housing = (page: Page) => page.evaluate(() => (window as any).__padova.housing() as HousingView);
const area = (page: Page) => page.evaluate(() => (window as any).__padova.area as string);
const interaction = (page: Page) => page.evaluate(() => (window as any).__padova.interaction());
const energy = (page: Page) => page.evaluate(() => (window as any).__padova.life()?.needs.energy as number);
const toast = (page: Page) => page.locator("#toast");

/** Unfolds a spot of the furnishing panel (the panel remembers spots left open). */
async function unfold(page: Page, spot: string): Promise<void> {
  const details = page.locator(`#home-panel [data-spot="${spot}"]`);
  if (!(await details.evaluate((node) => (node as HTMLDetailsElement).open))) await details.locator("> summary").click();
}

/** Turns the camera half way round by dragging (the student housing faces the square from the south, behind the first view). */
async function turnCamera(page: Page): Promise<void> {
  const yaw = () => page.evaluate(() => (window as any).__padova.cameraYaw as number);
  const before = await yaw();
  const { width, height } = page.viewportSize()!;
  const y = height * 0.62;
  await page.mouse.move(width * 0.2, y);
  await page.mouse.down();
  for (let k = 1; k <= 20; k++) await page.mouse.move(width * 0.2 + (Math.PI / 0.006) * (k / 20), y);
  await page.mouse.up();
  const turned = Math.abs(Math.atan2(Math.sin((await yaw()) - before), Math.cos((await yaw()) - before)));
  expect(turned, "camera turned").toBeGreaterThan(2.6);
}

test("desktop: rent a room, sleep, furnish, reload at home, go out and move out", async ({ browser }) => {
  test.setTimeout(300_000);
  const ada = await newPlayer(browser, "Ada");
  const ben = await newPlayer(browser, "Ben");
  const adaId = await selfId(ada);
  await expect.poll(async () => (await players(ben)).some((p) => p.id === adaId)).toBe(true);

  await test.step("the student housing's door offers a room to rent, from €25 a week", async () => {
    await walkTo(ada, -8, 14.5);
    await turnCamera(ada);
    await openObjectMenu(ada, DOOR);
    expect(await interaction(ada)).toMatchObject({ menu: { title: "Student housing", subtitle: "Rooms to rent", options: ["Rent a room…"], details: ["From €25.00 a week"] } });
  });

  await test.step("renting asks which room, then takes Ada straight in, out of Ben's sight", async () => {
    await ada.click('#action-menu [data-action="rent"]');
    const dialog = ada.locator(".ui-dialog");
    await expect(dialog).toContainText("Rent a room");
    await expect(dialog.locator('[data-action="dialog-confirm"]')).toBeDisabled();
    await expect(dialog.locator(".ui-dialog-choice")).toHaveCount(3);
    await dialog.locator('[data-choice="single-room"]').check();
    await ada.screenshot({ path: "test-results/m10-desktop-rent.png" });
    await dialog.locator('[data-action="dialog-confirm"]').click();
    await expect.poll(() => area(ada), { timeout: 20_000 }).toMatch(/^home\//);
    await expect(toast(ada)).toContainText("Welcome home", { timeout: 10_000 });
    expect((await housing(ada)).home).toMatchObject({ roomType: "single-room", placements: [] });
    await expect.poll(async () => (await players(ben)).some((p) => p.id === adaId), { timeout: 10_000 }).toBe(false);
    await turnCamera(ada); // face into the room again
  });

  await test.step("the character panel shows the room, its rent and that this week is paid", async () => {
    await ada.click("#me-chip");
    const home = ada.getByTestId("home");
    await expect(async () => {
      await home.scrollIntoViewIfNeeded({ timeout: 2_000 });
      await expect(home).toBeInViewport({ timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    await expect(home).toContainText("Single room · €45.00 a week");
    await expect(home.getByTestId("rent")).toContainText("This week is paid");
    await expect(ada.locator('#character-panel [data-action="furnish"]')).toBeEnabled();
    await ada.keyboard.press("Escape");
  });

  await test.step("sleeping in the room's bed: lying down, energy rising; waking early keeps what was slept", async () => {
    const before = await energy(ada);
    await openObjectMenu(ada, "home-bed");
    expect(await interaction(ada)).toMatchObject({ menu: { options: ["Sleep"], details: ["+50 energy · 3 min"] } });
    await ada.click('#action-menu [data-action="sleep"]');
    await expect.poll(async () => (await interaction(ada)).progress, { timeout: 20_000 }).toBe("Sleeping");
    await expect.poll(async () => (await players(ada)).find((p) => p.id === adaId)?.activity, { timeout: 10_000 }).toBe("sleeping");
    await ada.waitForTimeout(12_000);
    await ada.screenshot({ path: "test-results/m10-desktop-sleep.png" });
    await ada.keyboard.press("Escape");
    await expect.poll(async () => (await players(ada)).find((p) => p.id === adaId)?.activity, { timeout: 10_000 }).toBe("idle");
    expect(await energy(ada)).toBeGreaterThan(before);
  });

  await test.step("furnishing: buy a beanbag for the seat spot, see it at once and sit on it; then put it away", async () => {
    await ada.click("#me-chip");
    await ada.locator('#character-panel [data-action="furnish"]').click();
    const panel = ada.locator("#home-panel");
    await expect(panel).toBeVisible();
    await unfold(ada, "seat-1");
    await panel.locator('[data-spot="seat-1"] [data-buy="beanbag"]').click();
    await expect(toast(ada)).toContainText("Bought: Beanbag, €35.00.", { timeout: 10_000 });
    await expect.poll(async () => (await housing(ada)).home?.placements.map((p) => p.itemId)).toEqual(["beanbag"]);
    await expect(panel.locator('[data-spot="seat-1"] [data-put-away]')).toBeVisible();
    await ada.screenshot({ path: "test-results/m10-desktop-panel.png" });
    await ada.keyboard.press("Escape");
    await expect(panel).toBeHidden();

    await useObject(ada, "home-seat-1", "sit");
    await expect.poll(async () => (await players(ada)).find((p) => p.id === adaId)?.activity, { timeout: 15_000 }).toBe("sitting");
    await ada.screenshot({ path: "test-results/m10-desktop-beanbag.png" });

    await ada.click("#me-chip");
    await ada.locator('#character-panel [data-action="furnish"]').click();
    await unfold(ada, "seat-1");
    await panel.locator('[data-spot="seat-1"] [data-put-away]').click();
    await expect(toast(ada)).toContainText("Put away: Beanbag is in your storage.", { timeout: 10_000 });
    await expect(panel.getByTestId("storage")).toContainText("Beanbag");
    expect((await housing(ada)).home?.placements).toEqual([]);
    await ada.keyboard.press("Escape");
  });

  await test.step("a reload comes back home, with the room and the storage", async () => {
    const homeId = (await housing(ada)).home!.areaId;
    await ada.reload();
    await continueFromTitle(ada, "Ada");
    await expect.poll(() => area(ada), { timeout: 20_000 }).toBe(homeId);
    expect(await housing(ada)).toMatchObject({ home: { roomType: "single-room" }, storage: [{ itemId: "beanbag" }] });
  });

  await test.step("going out: back on the square, seen by Ben; the door now offers going home, changing room and moving out", async () => {
    const adaNow = await selfId(ada);
    await useObject(ada, "home-door", "enter");
    await expect.poll(() => area(ada), { timeout: 20_000 }).toBe("plaza");
    await expect.poll(async () => (await players(ben)).some((p) => p.id === adaNow), { timeout: 10_000 }).toBe(true);
    await turnCamera(ada);
    await openObjectMenu(ada, DOOR);
    expect(await interaction(ada)).toMatchObject({ menu: { subtitle: "You live here · single room", options: ["Go home", "Change room…", "Move out…"] } });
  });

  await test.step("moving out asks first; the furniture stays in storage", async () => {
    await ada.click('#action-menu [data-action="move_out"]');
    await expect(ada.locator(".ui-dialog")).toContainText("Move out?");
    await ada.click('.ui-dialog [data-action="dialog-confirm"]');
    await expect(toast(ada)).toContainText("You moved out", { timeout: 15_000 });
    expect(await housing(ada)).toMatchObject({ home: null, storage: [{ itemId: "beanbag" }] });
  });
});

test("mobile: the rent dialog and the home panel sheet have large touch targets", async ({ browser }) => {
  test.setTimeout(180_000);
  const chiara = await newPlayer(browser, "Chiara", { ...devices["Pixel 7"] });
  // Short hops: a portrait screen shows little to the sides.
  for (const [x, z] of [[-2.5, 13.5], [-5, 14], [-7.5, 14.5]] as const) await walkTo(chiara, x, z, true);
  await turnCamera(chiara); // a one-pointer drag, as with a finger
  const sheet = await openObjectMenu(chiara, DOOR, true);
  await sheet.locator('[data-action="rent"]').tap();
  const dialog = chiara.locator(".ui-dialog");
  await expect(dialog).toBeVisible();
  for (const choice of await dialog.locator(".ui-dialog-choice").all()) expect((await choice.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await dialog.locator('[data-choice="box-room"]').tap();
  await chiara.screenshot({ path: "test-results/m10-phone-rent.png" });
  await dialog.locator('[data-action="dialog-confirm"]').tap();
  await expect.poll(() => area(chiara), { timeout: 20_000 }).toMatch(/^home\//);

  await chiara.locator("#me-chip").tap();
  const furnish = chiara.locator('#character-panel [data-action="furnish"]');
  await expect(async () => {
    await furnish.scrollIntoViewIfNeeded({ timeout: 2_000 });
    await expect(furnish).toBeInViewport({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  await furnish.tap();
  const panel = chiara.locator("#home-panel");
  await expect(panel).toBeVisible();
  await expect(panel).toHaveClass(/is-sheet/);
  for (const summary of await panel.locator(".hp-spot > summary").all()) expect((await summary.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await panel.locator('[data-spot="decor-1"] > summary').tap();
  const options = panel.locator('[data-spot="decor-1"] .hp-option');
  await expect(options.first()).toBeVisible();
  for (const option of await options.all()) expect((await option.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await chiara.screenshot({ path: "test-results/m10-phone-panel.png" });
});
