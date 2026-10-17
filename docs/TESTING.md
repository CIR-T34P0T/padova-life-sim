# Testing

## Commands

| Command | Scope | Needs |
| --- | --- | --- |
| `npm run typecheck` | All packages, strict TypeScript | — |
| `npm test` | `shared/test` unit tests + `server/test` integration tests | — (starts its own server on port 2611) |
| `npm run check` | Both of the above | — |
| `npm run test:e2e` | Playwright, real server + real client + 3 browsers | A Chromium (`npx playwright install chromium`, or `CHROMIUM_PATH`) |

## What is covered

**Unit (13 tests, `shared/test/rules.test.ts`):** spawn points walkable;
obstacles and out-of-bounds blocked; no tunnelling; wall sliding; pathfinding
around obstacles with every segment walkable; blocked/out-of-bounds targets
rejected; path following at walking speed; message validation; direction
clamping; display-name sanitising.

**Server integration (9 tests, `server/test/plaza.test.ts`)** — real WebSocket
clients via the Colyseus SDK, nothing mocked: two players see each other;
guest naming; move replicated to another client; move into an obstacle
rejected without movement; forged `position`/`setState` messages ignored;
oversized direction capped to walking speed; malformed/out-of-bounds moves
rejected; leaving removes the player for others; a simulated network drop
reconnects to the same session and the player can still move.

**End to end (`e2e/walking-skeleton.spec.ts`)** — two desktop browsers and one
Chromium **mobile emulation** (Pixel 7 profile: touch, 412×839, mobile UA):
all three see each other; desktop click-to-move replicated; touch tap-to-move
replicated; WASD movement; virtual joystick movement (real touch events via
CDP); clicking an obstacle shows feedback and does not move; closing a tab
removes the player for the others. Screenshots are saved to `test-results/`.

## Results log

| Date | Suite | Result | Notes |
| --- | --- | --- | --- |
| 2026-10-17 | typecheck | Pass | shared, server, client |
| 2026-10-17 | unit + integration | 22/22 pass | Repeated runs, all passing |
| 2026-10-17 | e2e | 13 of 14 runs passed | Counted after fixing three test-script bugs (an occluded click target, a target at the screen edge, a single-shot check that should poll). One run then failed waiting up to 5 s for a join to finish; the join timeout is now 15 s and a failed join reports its on-screen error. 7 consecutive passes since. Suspected cause: CPU contention from three software-rendered WebGL pages. Runs used a preinstalled Chromium 141 via `CHROMIUM_PATH` because Playwright's browser download was blocked in that environment. |

## Known issues and gaps

Bugs (behaviour that is wrong or unreliable):

- **E2E join intermittently slow**: 1 of 14 runs timed out waiting for a join
  (see results log). Not reproduced since the timeout was raised; watch for it.

Untested or limited (behaviour that is unverified, or limited by design for now):

- **No physical phone or tablet tested yet.** Mobile results come from
  emulation. Manual check needed on a real Android phone and an iPhone (Safari).
- **Windows not tested.** All automated runs were on Linux. `scripts/dev.mjs`
  uses `npm.cmd` with `shell: true` on Windows, which has not been exercised.
- Reloading the page creates a new character (no persistence until M4, see D-008).
- Ground hidden behind an object from the camera's angle cannot be clicked:
  the click lands on the object and is refused. Rotate the camera instead.
  A later UX pass may route clicks to the ground behind low objects.
- The local player has no client-side prediction, so it responds with about
  100–150 ms of delay (D-006).
- Display names are not unique or reserved.
- Firefox and Safari not tested.
- Reconnection-window expiry (player removed after 20 s offline) is not
  covered by an automated test.
- Rendering performance not measured (no frame-time budget yet).
- Load beyond 3 simultaneous players not tested.
- `npm audit` reports 9 low/moderate advisories, all inside `@colyseus/auth`
  (pulled in by the SDK, unused by this project). The suggested `--force` fix
  would downgrade Colyseus to 0.15, so it was not applied. Recheck on Colyseus updates.
- Client bundle is 727 KB (194 KB gzipped), mostly Three.js; code splitting is a later optimisation.

## Notes for running tests in Claude's cloud workspace

- Playwright's browser download (`cdn.playwright.dev`) is blocked there. A
  Chromium is preinstalled; run the e2e suite with
  `CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npm run test:e2e`.
- Use absolute paths (`/home/claude/padova-life-sim`): `~` in the shell resolves
  to `/root`, not the project's parent folder.
- The Colyseus startup banner appears in test output; it is cosmetic.

## Manual test checklist (real devices)

1. `npm run dev` on a computer; open `http://<computer-ip>:5173` on a phone on the same Wi-Fi.
2. Join from the computer and the phone with different names; both see 2 players.
3. Tap the ground on the phone; the computer sees the character walk there.
4. Use the joystick; drag to rotate; pinch to zoom. The page must not scroll or zoom.
5. Turn the phone's Wi-Fi off for ~5 s, then on: the character goes translucent for others, then returns.
6. Close the phone browser tab: the computer shows 1 player within a few seconds.
