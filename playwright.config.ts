import { defineConfig, devices } from "@playwright/test";
import { clockOffsetFor } from "@padova/shared";

// End-to-end tests run the real server and the real client in real browsers.
// Ports differ from the dev defaults so tests never collide with `npm run dev`.
const SERVER_PORT = 2577;
const CLIENT_PORT = 5179;

// Optional: use an already-installed Chromium (e.g. where Playwright's browser
// download is blocked). Otherwise Playwright's bundled browser is used.
const executablePath = process.env.CHROMIUM_PATH || undefined;

// The game clock follows real time, so the café (open 06:00–23:00 game time)
// could be closed whenever the suite happens to run. Shift the test server's
// clock so the run starts at 09:00 game time on the nearest Wednesday: that
// leaves 14 game hours (84 real minutes at the default speed) of opening
// time, longer than the suite, and Wednesday has both lectures (on the hour)
// and an exam sitting (09:00–19:00) for the university test (M8).
// E2E_CLOCK_OFFSET_MINUTES overrides it (e.g. to try the closed café).
const WEDNESDAY = 2;
const clockOffset = process.env.E2E_CLOCK_OFFSET_MINUTES ?? String(clockOffsetFor(Date.now(), WEDNESDAY, 9));

const launchOptions = {
  executablePath,
  // Software WebGL so headless runs work on machines without a GPU.
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
};

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  outputDir: "test-results",
  use: {
    baseURL: `http://localhost:${CLIENT_PORT}`,
    launchOptions,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], launchOptions } }],
  webServer: [
    {
      command: `npm run start -w server`,
      // In-memory database so tests never touch a developer's saved data in .data/.
      // Set E2E_DATABASE_URL to run the browser tests against a real PostgreSQL server.
      env: {
        PORT: String(SERVER_PORT),
        LOG_LEVEL: "warn",
        PGLITE_DATA_DIR: "memory://",
        // The suite creates many characters from one address; lift the abuse limit for tests only.
        GUEST_CREATIONS_PER_IP_PER_HOUR: "1000",
        GAME_CLOCK_OFFSET_MINUTES: clockOffset,
        DATABASE_URL: process.env.E2E_DATABASE_URL ?? "",
      },
      port: SERVER_PORT,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `npm run dev -w client`,
      // Lighter world detail by default (software rendering is slow; gameplay is
      // identical). E2E_QUALITY=high runs every browser at desktop detail;
      // e2e/world.spec.ts always checks the full-detail world.
      env: { CLIENT_PORT: String(CLIENT_PORT), VITE_SERVER_URL: `ws://localhost:${SERVER_PORT}`, VITE_DEFAULT_QUALITY: process.env.E2E_QUALITY ?? "low" },
      port: CLIENT_PORT,
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
