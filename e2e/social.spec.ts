// Relationships and safety (M9) in real browsers against the real server.
// Desktop, two players: the player menu (Greet, Chat, Profile, Block…,
// Report…), a real 10-second chat that the other player is told about, both
// player cards showing the same new relationship, blocking from the card (the
// other player then can't reach you), unblocking from the character panel,
// and reporting with a reason and a note (which also blocks). Phone (Pixel 7
// emulation, not a physical device): the menu sheet, the card as a bottom
// sheet and the report dialog's touch targets.

import { devices, expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { createCharacter, openPlayerMenu } from "./helpers.ts";

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

const selfId = (page: Page) => page.evaluate(() => (window as any).__padova.selfId as string);
const interaction = (page: Page) => page.evaluate(() => (window as any).__padova.interaction());
const social = (page: Page) => page.evaluate(() => (window as any).__padova.social());
const players = (page: Page) => page.evaluate(() => (window as any).__padova.players() as { id: string }[]);
const toast = (page: Page) => page.locator("#toast");

test("desktop: chat, see the relationship on both cards, block from the card, unblock from the panel, report with a reason", async ({ browser }) => {
  test.setTimeout(300_000);
  const ada = await newPlayer(browser, "Ada");
  const ben = await newPlayer(browser, "Ben");
  const benId = await selfId(ben);
  const adaId = await selfId(ada);
  await expect.poll(async () => (await players(ada)).length).toBe(2);
  await ada.waitForTimeout(500);

  await test.step("the player menu offers Greet, Chat, Profile, Block and Report", async () => {
    await openPlayerMenu(ada, benId);
    expect(await interaction(ada)).toMatchObject({ menu: { title: "Ben", options: ["Greet", "Chat", "Profile", "Block…", "Report…"] } });
  });

  await test.step("a chat lasts 10 real seconds; Ben is told; both cards then show the same new relationship", async () => {
    await ada.click('#action-menu [data-action="chat"]');
    await expect.poll(async () => (await interaction(ada)).progress, { timeout: 15_000 }).toBe("Chatting with Ben");
    await expect(toast(ben)).toContainText("Ada is chatting with you.", { timeout: 15_000 });
    await expect.poll(async () => (await interaction(ada)).currentAction, { timeout: 30_000 }).toBeNull();

    await openPlayerMenu(ada, benId);
    await ada.click('#action-menu [data-action="profile"]');
    const card = ada.locator("#player-card");
    await expect(card).toBeVisible();
    await expect(card.getByTestId("relationship-level")).toHaveText("Acquaintance", { timeout: 10_000 });
    await expect(card.getByTestId("friendship")).toContainText("5 of 100");
    await expect(card).toContainText("Chatted");
    await expect(card).toContainText("Ben");
    await ada.screenshot({ path: "test-results/m9-desktop-card.png" });

    await openPlayerMenu(ben, adaId);
    await ben.click('#action-menu [data-action="profile"]');
    await expect(ben.locator("#player-card").getByTestId("friendship")).toContainText("5 of 100", { timeout: 10_000 });
    await ben.keyboard.press("Escape");
    await expect(ben.locator("#player-card")).toBeHidden();
  });

  await test.step("Ada blocks Ben from the card; Ben can't chat with her; her menu on him offers only Profile and Unblock", async () => {
    await ada.locator('#player-card [data-action="block"]').click();
    await expect(ada.locator(".ui-dialog")).toContainText("Block Ben?");
    await ada.click('.ui-dialog [data-action="dialog-confirm"]');
    await expect(toast(ada)).toContainText("You blocked Ben.", { timeout: 10_000 });
    await expect(ada.locator("#player-card").getByTestId("blocked-note")).toBeVisible();
    await expect(ada.locator('#player-card [data-action="unblock"]')).toHaveText("Unblock");
    await ada.keyboard.press("Escape");

    await openPlayerMenu(ben, adaId);
    await ben.click('#action-menu [data-action="chat"]');
    await expect(toast(ben)).toContainText("They can't be reached right now.", { timeout: 10_000 });

    await openPlayerMenu(ada, benId);
    expect(await interaction(ada)).toMatchObject({ menu: { title: "Ben", subtitle: "Blocked", options: ["Profile", "Unblock"] } });
    await ada.keyboard.press("Escape");
  });

  await test.step("Ada's character panel lists Ben under Blocked players; Unblock lifts it", async () => {
    await ada.click("#me-chip");
    const blocked = ada.getByTestId("blocked");
    await expect(async () => {
      await blocked.scrollIntoViewIfNeeded({ timeout: 2_000 });
      await expect(blocked).toBeInViewport({ timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    await expect(blocked).toContainText("Ben");
    await expect(ada.getByTestId("story")).toBeVisible();
    await ada.screenshot({ path: "test-results/m9-desktop-panel.png" });
    await blocked.locator('[data-action="unblock"]').click();
    await expect(toast(ada)).toContainText("You unblocked Ben.", { timeout: 10_000 });
    await expect(blocked).toContainText("Nobody");
    await ada.keyboard.press("Escape");
  });

  await test.step("reporting Ben needs a reason, takes an optional note, and also blocks him", async () => {
    await openPlayerMenu(ada, benId);
    await ada.click('#action-menu [data-action="report"]');
    const dialog = ada.locator(".ui-dialog");
    await expect(dialog).toContainText("Report Ben");
    await expect(dialog.locator('[data-action="dialog-confirm"]')).toBeDisabled();
    await dialog.locator('[data-choice="harassment"]').check();
    await dialog.locator("input.text-field").fill("Test report from the browser test");
    await ada.screenshot({ path: "test-results/m9-desktop-report.png" });
    await dialog.locator('[data-action="dialog-confirm"]').click();
    await expect(toast(ada)).toContainText("your report was sent, and Ben is blocked for you", { timeout: 10_000 });
    await expect.poll(async () => (await social(ada)).blockedPlayers).toEqual([benId]);
  });
});

test("mobile: the player sheet, the card as a bottom sheet and the report dialog have large touch targets", async ({ browser }) => {
  test.setTimeout(150_000);
  const chiara = await newPlayer(browser, "Chiara", { ...devices["Pixel 7"] });
  const dario = await newPlayer(browser, "Dario");
  const darioId = await selfId(dario);
  await expect.poll(async () => (await players(chiara)).length).toBe(2);
  await chiara.waitForTimeout(500);
  const sheet = await openPlayerMenu(chiara, darioId, true);
  const profile = sheet.locator('[data-action="profile"]');
  expect((await profile.boundingBox())!.height).toBeGreaterThanOrEqual(48);
  await profile.tap();
  const card = chiara.locator("#player-card");
  await expect(card).toBeVisible();
  await expect(card).toHaveClass(/is-sheet/);
  await expect(card).toContainText("You haven't spent time together yet", { timeout: 10_000 });
  for (const action of ["block", "report"]) expect((await card.locator(`[data-action="${action}"]`).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await chiara.screenshot({ path: "test-results/m9-phone-card.png" });
  await card.locator('[data-action="report"]').tap();
  const dialog = chiara.locator(".ui-dialog");
  await expect(dialog).toBeVisible();
  for (const choice of await dialog.locator(".ui-dialog-choice").all()) expect((await choice.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await chiara.screenshot({ path: "test-results/m9-phone-report.png" });
  await dialog.locator('[data-action="dialog-cancel"]').tap();
  await expect(dialog).toBeHidden();
});
