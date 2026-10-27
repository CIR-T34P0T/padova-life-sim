// Deleting a guest profile (M12) in real browsers against the real server:
// Settings has no "Your data" section before there is a profile; with one,
// "Delete my profile…" asks for the typed word, is refused while a character
// is being played in another window, then deletes every character, tells
// every open window of that profile, and the browser forgets the guest (a
// reload is a new visitor with no notice).

import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { createCharacter, waitForTitle } from "./helpers.ts";

const TOKEN_KEY = "padova.guestToken.v1";

const openContexts: BrowserContext[] = [];
test.afterEach(async () => {
  await Promise.all(openContexts.splice(0).map((context) => context.close().catch(() => undefined)));
});

async function openPage(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  page.on("pageerror", (error) => console.error("page error:", error.message));
  await page.goto("/");
  await waitForTitle(page);
  return page;
}

const screen = (page: Page) => page.evaluate(() => (window as any).__flow.screen() as string);
const lobby = (page: Page) => page.evaluate(() => (window as any).__flow.lobby());
const token = (page: Page) => page.evaluate((key) => localStorage.getItem(key), TOKEN_KEY);

test("delete my profile: typed word, refused while playing elsewhere, every window told, the browser forgets the guest", async ({ browser }) => {
  test.setTimeout(150_000);
  const context = await browser.newContext();
  openContexts.push(context);
  const first = await openPage(context);

  // No profile yet: Settings has nothing to delete.
  await first.click('#screens [data-action="settings"]');
  await expect(first.locator('#screens [data-setting="graphics"]')).toBeVisible();
  await expect(first.locator('#screens [data-setting="profile-data"]')).toHaveCount(0);
  await first.keyboard.press("Escape");
  await waitForTitle(first);

  // A character, still being played in the first window; the same profile at the title in a second window.
  await createCharacter(first, "Nora");
  expect(await token(first)).not.toBeNull();
  const second = await openPage(context);
  await expect.poll(async () => (await lobby(second)).characters.map((c: any) => c.displayName)).toEqual(["Nora"]);

  await second.click('#screens [data-action="settings"]');
  const row = second.locator('#screens [data-setting="profile-data"]');
  await expect(row).toContainText("Your data");
  const remove = row.locator('[data-action="delete-profile"]');
  expect((await remove.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await remove.click();
  const dialog = second.locator(".ui-dialog");
  await expect(dialog).toContainText("Delete your profile?");
  await expect(dialog).toContainText("your character");
  const confirm = dialog.locator('[data-action="dialog-confirm"]');
  await dialog.locator(".text-field").fill("nope");
  await expect(confirm).toBeDisabled();
  await dialog.locator(".text-field").fill(" Delete ");
  await confirm.click();
  await expect(dialog).toContainText("being played in another window");
  expect(await token(second)).not.toBeNull();

  // Back to the title in the first window, then the deletion goes through.
  await first.click("#me-chip");
  await first.click('#character-panel [data-action="leave-to-title"]');
  await waitForTitle(first);
  await second.screenshot({ path: "test-results/m12-delete-dialog.png" });
  await confirm.click();
  for (const page of [second, first]) {
    await expect.poll(() => screen(page), { timeout: 15_000 }).toBe("message");
    await expect(page.locator("#screens .message-title")).toHaveText("Profile deleted");
  }
  expect(await token(second)).toBeNull();
  await second.screenshot({ path: "test-results/m12-deleted.png" });

  // A fresh start: no characters, and nothing to delete.
  await second.click('#screens [data-action="message-action"]');
  await waitForTitle(second);
  await expect(second.locator('#screens [data-action="continue"]')).toContainText("No saved life yet");
  await second.reload();
  await waitForTitle(second);
  const fresh = await lobby(second);
  expect(fresh.characters).toEqual([]);
  expect(fresh.message ?? "").not.toContain("couldn't find");
  await second.click('#screens [data-action="settings"]');
  await expect(second.locator('#screens [data-setting="profile-data"]')).toHaveCount(0);
});
