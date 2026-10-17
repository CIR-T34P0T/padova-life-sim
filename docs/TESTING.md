# Testing

## Commands

| Command | Scope | Needs |
| --- | --- | --- |
| `npm run typecheck` | All packages, strict TypeScript | — |
| `npm test` | `shared/test` unit tests + `server/test` integration tests | — (starts its own servers on ports 2611–2620, each with an in-memory PGlite database) |
| `TEST_DATABASE_URL=… npm test` | The same, plus every database test repeated on a real PostgreSQL server | A PostgreSQL user allowed to create databases; each test creates and drops a throwaway database |
| `npm run check` | Both of the above | — |
| `npm run test:e2e` | Playwright, real server + real client + several browsers | A Chromium (`npx playwright install chromium`, or `CHROMIUM_PATH`). The test server uses an in-memory database (never `.data/`) and a raised guest-creation limit |
| `E2E_DATABASE_URL=… npm run test:e2e` | The browser tests with the server on a real PostgreSQL | An empty database the tests may write to |

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

**Profile rules (`shared/test/profile.test.ts`):** female and male presets and
eight skin tones; unique catalogue ids and a valid default; adult vs non-adult
categories; valid characters accepted with names cleaned; unexpected fields
such as a client-chosen id or owner ignored; non-adult player characters
refused; malformed input rejected; unknown appearance ids rejected naming the
field; retired/corrupt stored options replaced with defaults; version upgrades
run one step at a time; newer, missing-step and invalid versions refused.

**Database (`server/test/database.test.ts`)** — on in-memory PGlite and, with
`TEST_DATABASE_URL`, on a real PostgreSQL server: migration files numbered
without gaps; statement splitting; passwords never printed; fresh database
migrates idempotently; rollback and re-apply; guest + character created
atomically and only the token hash stored; account found only with the exact
token; appearance and position saved and loaded; reads/writes refused for a
non-owning account; one character per account; age-category and version
constraints enforced by the database itself; a failed creation rolls back
completely; configuration chooses the backend and resolves folders correctly.

**Profiles through the real room (`server/test/profiles.test.ts`)** — real
WebSocket clients: a first visit is anonymous and stores nothing; creating a
character issues a guest token once and others see the appearance; invalid
characters refused and the visitor stays anonymous; no second character; the
same character and saved position come back on a later visit; unknown or
malformed tokens refused (4401); appearance changes saved, replicated and kept;
invalid appearance refused; one player can never change another's profile
(forged ids in the payload are ignored); the newest session wins and the older
one is saved and closed (4100); a network drop keeps the character; a seated
character is saved where it would stand up; retired appearance options are
repaired on load and saved; a newer-version profile loads read-only and is
never overwritten; guest creations are limited per IP; autosave writes online
players' positions; **leaving and immediately rejoining loads the position the
old session was still saving** (regression test with deliberately slowed saves).

**End to end, persistence (`e2e/persistence.spec.ts`)** — create a character
with chosen options, walk, reload: no create form, same name, look, position
and guest token; edit appearance via clicking yourself, another player sees the
change, still there after a reload; a second tab takes the character over and
the first tab shows "Playing in another window", with only one copy in the
world; an unrecognised saved token is discarded and the create form explains why.

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
| 2026-10-17 (M4) | typecheck + unit + integration | 93/93 pass | `npm run check` and `npm test`. With `TEST_DATABASE_URL` pointing at a throwaway PostgreSQL 16.15 server: 102/102 (database tests on both backends) |
| 2026-10-17 (M4) | e2e | 7/7 pass | Plus the 4 persistence tests again with the server on real PostgreSQL 16.15 (`E2E_DATABASE_URL`): 4/4, rows confirmed in the database |
| 2026-10-17 (M4) | manual | Pass | Server restart on on-disk PGlite: character created, server stopped and started, same character id, name and appearance loaded. `db:status`, `db:migrate`, `db:rollback -- 2` run against a scratch database |
| 2026-10-17 (M4) | bugs found by tests | Fixed | (1) Race: a reload could load the position from before the closing tab's final save; fixed in `PlazaRoom` (removal is one shared promise that eviction waits for) with a regression test that failed before the fix. (2) A relative `PGLITE_DATA_DIR` depended on the working folder; now resolved from the repo root. Test-only fixes: browser tests now wait for rendered frames before computing screen points, raise the guest limit, and use an in-memory database |
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
- Ground hidden behind an object from the camera's angle cannot be clicked:
  the click lands on the object and is refused. Rotate the camera instead.
  A later UX pass may route clicks to the ground behind low objects.
- The local player has no client-side prediction, so it responds with about
  100–150 ms of delay (D-006).
- Display names are not unique or reserved.
- **M4 identity and persistence limitations:**
  - Guest identity only (D-017): no sign-in, recovery or cross-device play;
    clearing site data loses the character; a script injected into the page
    could read the token from `localStorage`. Needs HTTPS/WSS in production.
  - No account or character deletion workflow yet, and no cleanup of
    abandoned guest accounts.
  - Guest-creation limit and session registry are in memory, per server process.
  - Activity, seats and pending actions are not saved; after a reload the
    character stands at the spot it would stand up to.
  - One character per account (D-020); name and age can't be changed after creation.
  - The create/edit forms are minimal (no live preview); the full character
    creator is a later milestone.
  - Not tested: a real phone, Windows, Firefox, Safari; profile room tests run
    on PGlite only (the database layer and the persistence browser tests were
    also run on real PostgreSQL).
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
11. **Saved characters:** on first visit, create a character and pick a look.
    Walk somewhere, then reload the page: no create form, same look, same spot.
12. Tap yourself (standing) → **Edit appearance**, change the hair colour, save.
    The other device sees the change; reload and it is still there.
13. Stop the server (Ctrl+C), start it again, reload: the character is still there.
14. Open the game in a second tab of the same browser: the character moves to
    the new tab and the first tab says "Playing in another window".
