# Testing

## Commands

| Command | Scope | Needs |
| --- | --- | --- |
| `npm run typecheck` | All packages, strict TypeScript | — |
| `npm test` | `shared/test` unit tests + `server/test` integration tests | — (starts its own servers on ports 2611–2615) |
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

**Interaction rules (15 tests, `shared/test/interactions.test.ts`):** every
interactable has a matching obstacle and unique seat ids; every approach point
is walkable and reachable from spawn; menu contents for free, full and
occupied benches and desks; players never offer actions to themselves or when
offline; validation of wrong actions, full seats, distance, self/offline/
unknown targets and greeting cooldown; nearest-free-seat choice; walkable
greeting spot next to a wall; a walled-in bench is unreachable; `interact`
payload validation.

**Interaction integration (14 tests, `server/test/interactions.test.ts`)** —
real servers with faster tuning (walk 9 m/s, study 1.2 s, greet 0.5 s):
walk-sit lifecycle with seat reservation visible to others and exact seated
position; stand up frees the seat; two players racing for one desk seat (one
wins, the other gets `no_free_seat`); third player refused on a full bench;
invalid requests (unknown target, wrong action, stand when not seated, self,
unknown player, malformed); cancel while walking stops, frees the seat and
lets another player take it; walking elsewhere interrupts; study timed on the
server and forged completion messages ignored; seat kept through a drop and
freed on leave; greeting walks over, notifies the target and replicates the
gesture, then refuses a repeat (`too_soon`); greeting fails with
`target_left` when the target leaves; greeting a seated player leaves them
seated; `too_far` with a 25 m limit; `unreachable` in a walled world.

**End to end, interactions (`e2e/interactions.spec.ts`)** — desktop: dragging
across an object selects nothing; hover shows a pointer; clicking a bench
opens a radial menu with only "Sit"; Escape closes it; Sit walks there and
the other player sees the seat taken; clicking yourself while seated offers
Stand up; clicking another player offers Greet, who sees a toast and the
gesture; clicking yourself while standing selects nothing; a study desk
offers Study/Sit and the action can be cancelled while walking (seat
released). Mobile (Pixel 7 emulation): tapping a bench opens a bottom sheet
with buttons ≥ 48 px and hides the joystick in portrait; the close button
restores it; Sit works; a seated touch player greets another player.

**End to end, walking skeleton (`e2e/walking-skeleton.spec.ts`)** — two desktop browsers and one
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
| 2026-10-17 (M3) | typecheck | Pass | shared, server, client |
| 2026-10-17 (M3) | unit + integration | 51/51 pass | 28 shared + 23 server; `npm run check` and `npm test` run, plus two more full runs, all passing. While writing them, 5 interaction tests failed because they read replicated state before the next patch arrived; fixed in the tests by waiting for state (no server change) |
| 2026-10-17 (M3) | e2e | 3/3 pass, 3 consecutive full-suite runs | Earlier runs failed on test design only: targets behind the camera after the player moved, and contexts not closed after a failed test (now closed in `afterEach`). The walking-skeleton test still passes unchanged |
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
- **M3 interaction limitations:**
  - One action at a time; a new request replaces the current one (D-011). No multi-action queue.
  - Studying has no effect yet (no skills); it is a timed placeholder that ends with a toast.
  - No animations: sitting lowers the capsule; greeting shows a "Ciao!" bubble.
  - A greeter walks to where the other player was; if they keep moving, it
    re-plans up to 3 times, then fails with `target_moved`.
  - Objects hidden behind others from the camera's angle can't be selected;
    small, distant objects are hard to tap on a phone (no enlarged tap area yet).
  - No info panel for yourself (needs, skills, inventory) or for other players
    beyond name and activity; those systems don't exist yet.
  - Menus have no scrolling or paging; at most two options exist today.
  - The landscape layout of the action sheet has no automated test.
  - Greetings have no block/mute option yet, only a 5 s cooldown per pair.
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
7. Rejoin on the phone. Tap a bench: a bottom sheet appears with a large "Sit"
   button; tap it. The character walks over and sits; the computer sees
   "· sitting" on its name tag.
8. Tap your own character: the sheet offers "Stand up".
9. On the computer, click the phone player: the menu offers "Greet". Choose it;
   the phone shows `<name> says "Ciao!"` and the computer player shows a bubble.
10. Turn the phone sideways: the sheet docks to the right and the joystick stays usable.
