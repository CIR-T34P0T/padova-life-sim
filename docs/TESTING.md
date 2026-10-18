# Testing

## Commands

| Command | Scope | Needs |
| --- | --- | --- |
| `npm run typecheck` | All packages, strict TypeScript | — |
| `npm test` | `shared/test` unit tests + `server/test` integration tests | — (starts its own servers on ports 2611–2626, each with an in-memory PGlite database) |
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

**Interaction rules (18 tests, `shared/test/interactions.test.ts`):** every
interactable has a matching obstacle and unique seat ids; every approach point
is walkable and reachable from spawn; menu contents for free, full and
occupied benches and desks, the café counter and the fountain (standing spots
taken → `busy`); players never offer actions to themselves or when
offline; validation of wrong actions, full seats, distance, self/offline/
unknown targets and greeting cooldown; nearest-free-seat choice; walkable
greeting spot next to a wall; a walled-in bench is unreachable; `interact`
payload validation, including café item ids and purchase request ids.

**Life rules (25 tests, `shared/test/life.test.ts`, M5):** clock — starts at
08:00 Day 1, 10 game minutes per real minute, depends only on real time and
scale, rejects bad `GAME_TIME_SCALE` values; needs — documented rates, stay in
0–100, **nothing empties in under 90 real minutes of ordinary play**, walking
drains and sitting restores energy, trait effects, offline catch-up capped at
8 game hours at half rate with a floor of 35, "too tired" below 10 energy,
corrupt stored values repaired; mood — from needs (lows hurt twice as much as
highs help), recent events with reasons and expiry, no stacking, thresholds;
skills — XP curve (100, 300, 600 … 5500, max level 10), trait and mood
multipliers, cleaning stored XP; traits — at most two distinct known ids;
money — whole cents, euro formatting, no spending beyond the balance, **the
daily allowance pays for a day of food**, safe request ids; action effects —
what each action and café item does, proportional shares when stopped early,
halved social gain when grubby.

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

**Life simulation through the real room (15 tests, `server/test/life.test.ts`,
M5)** — real WebSocket clients and servers with faster tuning: entering with
starting needs, money and empty skills, with the clock from the server; **the
complete loop** (buy a panino, eat it, study, see every change in `life`
messages, leave and come back to the same values, with the ledger checked in
the database; a client-sent price is ignored); a repeated purchase request
charged and served once (`duplicate_request`); a burst of orders charges only
the one that reaches the counter; unknown and missing items refused; too tired
to study until an espresso helps; greeting lifts both players' social need and
the greeter's communication; sketching (creativity, fun) and washing
(hygiene); an Organised character learns 15–25 % more from the same session;
**life data private** (other players never receive it); insufficient funds
refused before walking with nothing charged; an order abandoned during
payment is refunded (slowed database); needs follow the server clock (scale
600), not client frames; offline catch-up capped; daily allowance once per
game day.

**Life database (11 tests, `server/test/lifeDatabase.test.ts`, M5)** — the
migration gives pre-M5 characters needs, a wallet and a starting allowance;
rollback leaves profiles intact; creation writes traits, needs, wallet and
ledger in one go; save/load only for the owner; need and XP limits enforced by
the database itself; a purchase is charged once and a repeated request returns
the same result; insufficient funds writes nothing; the balance can't go
negative even by a direct UPDATE; another account's money can't be moved;
**of two simultaneous purchases that the balance covers once, exactly one
succeeds**; refunds and allowances once per key. Runs on PGlite and, with
`TEST_DATABASE_URL`, on PostgreSQL too.

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

**End to end, life simulation (`e2e/life.spec.ts`, M5)** — desktop, with the
game's real durations: create a character with a trait; click yourself →
Character opens a panel (≤ 30 % of the screen width) showing traits, mood,
current action, all needs, skills and money; with the panel still open, walk
to the café, buy a panino from the menu (prices shown), see €4.50 charged
exactly once in the panel and ledger, "Eating a panino", hunger rising; walk
to a desk and study, academic XP rising (15–31 XP for one session) and shown
in the panel; reload and get the same skills, money, purchase history and
needs back. Every click is checked to reach the 3D view, not the panel. Phone
(Pixel 7 emulation): the HUD chip doesn't overlap the connection pills and is
≥ 44 px tall; tap yourself → Character opens a bottom sheet under half the
screen height, hides the joystick, scrolls to the money section; closing
restores the joystick; the chip toggles the panel.

**End to end, interactions (`e2e/interactions.spec.ts`)** — desktop: dragging
across an object selects nothing; hover shows a pointer; clicking a bench
opens a radial menu with "Sit" and "Sketch"; Escape closes it; Sit walks there and
the other player sees the seat taken; clicking yourself while seated offers
Sketch, Stand up and Character; clicking another player offers Greet, who sees a toast and the
gesture; clicking yourself while standing offers only your own options (Character, Edit appearance); a study desk
offers Study/Sit and the action can be cancelled while walking (seat
released). Mobile (Pixel 7 emulation): tapping a bench opens a bottom sheet
with buttons ≥ 48 px and hides the joystick in portrait; the close button
restores it; Sit works; a seated touch player greets another player.

**End to end, walking skeleton (`e2e/walking-skeleton.spec.ts`)** — two desktop browsers and one
Chromium **mobile emulation** (Pixel 7 profile: touch, 412×839, mobile UA):
all three see each other; desktop click-to-move replicated; touch tap-to-move
replicated; WASD movement; virtual joystick movement (real touch events via
CDP); clicking a solid, non-interactive object (a market stall) shows
feedback and does not move; closing a tab
removes the player for the others. Screenshots are saved to `test-results/`.

## Results log

| Date | Suite | Result | Notes |
| --- | --- | --- | --- |
| 2026-10-18 (M5) | typecheck + build | Pass | shared, server, client; client production build |
| 2026-10-18 (M5) | unit + integration | 150/150 pass | `npm run check` (70 shared + 80 server). With `TEST_DATABASE_URL` on a throwaway PostgreSQL 16.15: 170/170 (database and life-database tests on both backends) |
| 2026-10-18 (M5) | e2e | 9/9 pass | Full suite twice: once on the in-memory database, once with the server on PostgreSQL 16.15 (`E2E_DATABASE_URL`, empty database); the café purchase (one 450-cent "Panino" row, balance 11 500 → 11 050) and 26.4 academic XP confirmed with SQL. The life loop uses the game's real durations (about 70 s) |
| 2026-10-18 (M5) | manual | Pass | Server started with `GAME_TIME_SCALE=60` (logged and used) and with `GAME_TIME_SCALE=abc` (refuses to start with a clear message) |
| 2026-10-18 (M5) | bugs found by tests | Fixed | (1) Radial menu options overlapped when labels were long ("Character" under "Edit appearance"; the café's priced options would too); the fan now widens, then becomes a column. (2) The café counter stood in front of the 12 m south building, which hid it and the player from the default camera; moved into the open piazza. (3) `GAME_TIME_SCALE` was documented but never read; now read by the server entry point. (4) Walking-skeleton and desktop-interactions e2e tests exceeded 60 s on this 2-CPU machine, at the M4 commit as well (checked in a separate worktree): timeouts raised to 150 s |
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
- **Multi-browser e2e tests are slow on 2-CPU machines.** In the M5 session's
  container the walking-skeleton and desktop-interactions tests needed just
  over 60 s and timed out, at the M4 commit too (checked), so the cause is
  machine speed (three software-rendered WebGL pages), not M5. Those tests now
  allow 150 s.

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
- **M5 life simulation limitations:**
  - Cooking skill exists but nothing trains it yet (no kitchen). No inventory:
    café food is eaten at once. No beds or sleep: energy recovers only by
    sitting, coffee and offline time.
  - Skill levels don't unlock anything yet; traits can only be chosen when
    creating a character, so characters created before M5 have none.
  - A meal or study session interrupted by a disconnect keeps what was applied
    so far; the rest is lost (the price is not refunded once eating started).
  - Mood has no visible effect on the avatar (no animations yet).
  - Balance tuning (rates, prices, allowance) is a first pass from the design
    doc and unit tests; it has not been play-tested by people.
  - Changing `GAME_TIME_SCALE` moves the world clock (by design, D-021): mood
    event times and the allowance day are in game minutes, so switching scales
    on a database with real players can expire events or allow an extra
    allowance. Development and testing only.
  - The character panel's landscape-phone layout (docked right) and the
    radial menu's stacked layout on narrow desktop windows have no automated
    test. Camera occlusion is not handled: buildings can hide characters at
    the south edge of the piazza.
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
  - No animations: sitting lowers the capsule; greeting shows a "Ciao!" bubble.
  - A greeter walks to where the other player was; if they keep moving, it
    re-plans up to 3 times, then fails with `target_moved`.
  - Objects hidden behind others from the camera's angle can't be selected;
    small, distant objects are hard to tap on a phone (no enlarged tap area yet).
  - No info panel for other players beyond name and activity (your own
    character panel exists since M5).
  - Menus have no scrolling or paging; at most three options exist today
    (the café). Long labels switch the radial fan to a column.
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
- Client bundle is 769 KB (208 KB gzipped), mostly Three.js; code splitting is a later optimisation.

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
15. **Life simulation (M5):** create a new character and pick a personality
    trait. Tap/click yourself → **Character**: the panel shows mood, needs,
    skills and €115.00 (€100 start + today's €15). On a phone it is a bottom
    sheet covering less than half the screen.
16. Walk east to the café counter, open it and buy a **Panino** (€4.50). The
    balance drops once, the panel says "Eating a panino" and hunger rises over
    about 15 seconds.
17. Study at a desk for 20 seconds: Academic XP rises in the panel; energy and
    fun dip a little.
18. Reload the page (and, once, restart the server): money, purchases, skills
    and needs are as you left them.
