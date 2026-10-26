// Day and night (M7b, D-037) in real browsers.
// - The world lab (no server) at chosen times: the light follows the time,
//   night costs at most two draw calls, and characters stay as easy to see as
//   at midday (measured from the picture).
// - The real game: the very first frame after entering already shows the
//   server's time of day (no flash of the wrong light), and two players see
//   the same time of day. The e2e server's clock starts at 09:00 game time
//   (playwright.config.ts), so the game part runs by day; night in the game
//   uses the same code path, and night itself is checked in the world lab.

import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { daylightAt, phaseOf } from "../client/src/render/world/daylight.ts";
import { createCharacter } from "./helpers.ts";

const openContexts: BrowserContext[] = [];
test.afterEach(async () => {
  await Promise.all(openContexts.splice(0).map((context) => context.close().catch(() => undefined)));
});

async function newPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1100, height: 680 } });
  openContexts.push(context);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  (page as unknown as { errors: string[] }).errors = errors;
  return page;
}

interface LabReading {
  phase: string;
  lamps: number;
  stars: number;
  drawCalls: number;
  triangles: number;
  /** Per character: brightness (0–1) and contrast with the ground around it, relative to the ground. */
  people: { brightness: number; contrast: number }[];
}

/** The world lab's game view with a few characters, at a time of day; reads the picture. */
async function readLab(page: Page, time: string): Promise<LabReading> {
  await page.goto(`/world-lab.html?view=game&people&quality=low&time=${time}`);
  await page.waitForFunction(() => ((window as any).__worldLab?.frames ?? 0) > 12, null, { timeout: 120_000 });
  return page.evaluate(() => {
    const lab = (window as any).__worldLab;
    const canvas = document.getElementById("stage") as HTMLCanvasElement;
    const copy = document.createElement("canvas");
    copy.width = canvas.width;
    copy.height = canvas.height;
    const ctx = copy.getContext("2d")!;
    ctx.drawImage(canvas, 0, 0);
    const scale = canvas.width / canvas.clientWidth;
    const box = (x0: number, x1: number, y0: number, y1: number) => {
      let sum = 0;
      let n = 0;
      for (let x = Math.round(x0); x <= x1; x++) {
        for (let y = Math.round(y0); y <= y1; y++) {
          const d = ctx.getImageData(Math.round(x * scale), Math.round(y * scale), 1, 1).data;
          sum += (0.2126 * d[0]! + 0.7152 * d[1]! + 0.0722 * d[2]!) / 255;
          n++;
        }
      }
      return sum / n;
    };
    // Two of the lab's characters: one walking in the open (dark clothes), one at the café counter.
    const measure = (x: number, z: number, groundZ: number) => {
      const head = lab.screenPoint(x, 1.5, z);
      const hip = lab.screenPoint(x, 0.95, z);
      const person = box(head.x - 3, head.x + 3, head.y, hip.y);
      const ring = [-1.4, 1.4].flatMap((dx) => [lab.screenPoint(x + dx, 0, groundZ)]).concat([lab.screenPoint(x, 0, groundZ + 1.4)]);
      const ground = ring.reduce((sum: number, p: { x: number; y: number }) => sum + box(p.x - 3, p.x + 3, p.y - 3, p.y + 3), 0) / ring.length;
      return { brightness: person, contrast: Math.abs(ground - person) / ground };
    };
    return {
      phase: lab.daylight.phase,
      lamps: lab.daylight.lamps,
      stars: lab.daylight.stars,
      drawCalls: lab.drawCalls,
      triangles: lab.trianglesDrawn,
      people: [measure(1.5, 12.5, 12.5), measure(8.25, 8.95, 9.55)],
    };
  });
}

test("world lab: the light follows the time of day, night costs two draw calls, and characters stay as easy to see", async ({ browser }) => {
  test.setTimeout(240_000);
  const page = await newPage(browser);
  const noon = await readLab(page, "12:00");
  const dusk = await readLab(page, "19:40");
  const night = await readLab(page, "23:00");
  await page.screenshot({ path: "test-results/m7b-lab-night.png" });

  expect(noon).toMatchObject({ phase: "day", lamps: 0, stars: 0 });
  expect(dusk.phase).toBe("dusk");
  expect(dusk.lamps).toBeGreaterThan(0.3);
  expect(night).toMatchObject({ phase: "night", lamps: 1, stars: 1 });

  // Budgets (ASSET_PIPELINE.md): by day nothing is added; at night the lamplight pools and the stars, one draw call each.
  expect(night.drawCalls - noon.drawCalls).toBeLessThanOrEqual(2);
  expect(night.triangles - noon.triangles).toBeLessThan(2_000);

  // Readability: each character keeps most of its brightness and its contrast with the ground around it.
  for (const [k, person] of noon.people.entries()) {
    for (const [name, reading] of [["dusk", dusk], ["night", night]] as const) {
      const other = reading.people[k]!;
      expect(other.brightness / person.brightness, `character ${k + 1} brightness at ${name}`).toBeGreaterThan(0.55);
      expect(other.contrast / person.contrast, `character ${k + 1} contrast at ${name}`).toBeGreaterThan(0.8);
    }
  }
  expect((page as unknown as { errors: string[] }).errors).toEqual([]);
});

test("game: the first frame after entering already shows the server's time of day, the same for two players", async ({ browser }) => {
  test.setTimeout(150_000);
  const players: Page[] = [];
  for (const name of ["Aurora", "Vespero"]) {
    const page = await newPage(browser);
    await page.goto("/");
    await createCharacter(page, name);
    players.push(page);
  }
  for (const page of players) {
    const entry = await page.evaluate(() => (window as any).__padova.entryLight());
    expect(entry, "the entry frame was recorded").not.toBeNull();
    // The light of that first frame came from the server's clock, not a default.
    expect(entry.daylight.minute).not.toBeNull();
    expect(entry.daylight.minute).toBe(Math.floor(entry.gameMinute));
    expect(entry.daylight.phase).toBe(phaseOf(entry.daylight.minute));
    expect(entry.daylight.lamps).toBeCloseTo(daylightAt(entry.daylight.minute).lamps, 6);
  }
  // Both players see the same time of day (one game minute is 6 real seconds; allow one step between reads).
  const [a, b] = await Promise.all(players.map((page) => page.evaluate(() => (window as any).__padova.worldStats().daylight)));
  expect(Math.abs(a.minute - b.minute)).toBeLessThanOrEqual(1);
  expect(a.phase).toBe(b.phase);
  // The suite's clock starts at 09:00 game time: daylight, lamps off.
  expect(a.phase).toBe("day");
  expect(a.lamps).toBe(0);
  for (const page of players) expect((page as unknown as { errors: string[] }).errors).toEqual([]);
});
