# Testing

## Commands

| Command | Scope | Needs |
| --- | --- | --- |
| `npm run typecheck` | All packages, strict TypeScript | — |
| `npm test` | `shared/test` unit tests, `client/test` (the district art against the collision layout, in Node) and `server/test` integration tests | — (starts its own servers on ports 2611–2629, each with an in-memory PGlite database) |
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

**Profile rules (`shared/test/profile.test.ts`):** adult vs non-adult
categories; valid characters accepted with names cleaned; unexpected fields
such as a client-chosen id or owner ignored; non-adult player characters
refused; malformed input rejected; invalid appearance refused naming the
field (`hair.colour`); version upgrades run one step at a time; **an M5
(version 2) flat appearance upgrades to a config that keeps its look**, and
corrupt version-2 data upgrades to a valid config; newer, missing-step and
invalid versions refused.

**Appearance rules (`shared/test/appearance.test.ts`, M6):** catalogue ids
unique with labels and valid colours; every hair texture from straight to
tightly coiled and the protective styles exist; **no option, field or preset
mentions ethnicity, nationality or heritage**; skin tones get steadily deeper
along the slider with no jumps, hit the nine named stops exactly, and
undertones shift hue without changing depth; bad input never throws; strict
validation names the bad field (version, missing section, unknown id, slider
out of range, NaN, wrong type) and drops unknown fields; stored data is
repaired (sliders clamped, bad ids replaced and listed); 200 random looks
round-trip through the replicated string under 2 KB; equal looks encode to
equal strings; unreadable looks decode to the default; look codes round-trip
and tampered codes are refused; presets are valid, unique and span the skin
range, every hair texture, both frames and five or more builds; the
randomiser is deterministic, always valid, **can produce every option of
every field**, and randomising one section leaves the others unchanged;
visibility rules (full outfit hides top and bottom, headwrap/headscarf hide
hair, hats keep long hair below them, hair clips need hair); M4 options all
map to valid configs in the old skin-tone order.

**Boundaries (`server/test/boundaries.test.ts`, M6):** no life-simulation
rule mentions appearance (looks have no gameplay effect) and the appearance
schema has no ethnicity, race, heritage or nationality field.

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
token; appearance and position saved and loaded, **with the M4 columns
holding the closest old look**; reads/writes refused for a non-owning
account; **several characters per account up to the limit, also when two
are created at the same time (exactly one of the racing pair fits)**; the
list comes back most recently played first and never includes another
account's characters; **deleting a character removes its rows in every
per-character table, only for its owner, and keeps the account, token and
other characters**; rolling back migration 0004 works with one character
per account and fails without changing anything with two; age-category and version constraints
enforced by the database itself; the appearance document must be a JSON
object under 4 KB; **rolling back migration 0003 leaves a version-2
character with the closest old look, and migrating again loads it**; a
failed creation rolls back completely; configuration chooses the backend and
resolves folders correctly.

**Profiles through the real room (`server/test/profiles.test.ts`)** — real
WebSocket clients: a first visit is anonymous (an empty title screen) and
stores nothing; creating a character issues a guest token once and others
see the appearance; invalid characters refused and the visitor stays
anonymous; no creating or entering another character while in the world
(`in_world`); a later visit shows the character on the title screen (look,
last played, no life data) without placing it in the world, and entering
brings back the same character at its saved position; unknown or
malformed tokens refused (4401); appearance changes saved, replicated (the
decoded `look` equals the saved config) and kept; invalid appearance refused
naming the field (`skin.tone`, `body.height`, `v`); one player can never change another's profile
(forged ids in the payload are ignored); the newest session **in the world**
wins and the older one is saved and closed (4100), while a second window
that only opens the title screen disconnects nobody; a network drop keeps the character; a seated
character is saved where it would stand up; retired appearance options are
repaired on load (only the broken fields fall back, one readable notice) and
saved; **an M5 character (version 2, flat columns, no document) is upgraded
on load, keeps its look, is saved as version 3 and replicates the new look**;
a newer-version profile loads read-only and is
never overwritten; guest creations are limited per IP; autosave writes online
players' positions; **leaving and immediately rejoining loads the position the
old session was still saving** (regression test with deliberately slowed saves).

**Creator categories and title screen requests (6 tests,
`shared/test/categories.test.ts`):** every appearance field belongs to
exactly one of the six creator categories; randomising one category never
touches another (12 seeds each, always valid); resetting one category
restores only it; the review summary describes every preset in plain words
and says when hair is covered; character ids must be UUIDs; deleting needs a
typed name, compared without case or extra spaces.

**District layout (8 tests, `shared/test/world.test.ts`, world art pass):**
every obstacle has a unique id, a real size, a label and a place inside the
square; no two solid boxes overlap (they may touch); the eight chairs belong
to existing interactables and every sitter sits on a chair; **no walkable
pocket is cut off** from where players arrive (flood fill over the
navigation grid); the university hall's porch is walkable and reachable;
the portico can be walked end to end behind its columns and entered
between them; every street is walkable up to its planters and blocked
there; the arrival points see each other and a short route leads to the
fountain.

**District art against collision (10 tests, `client/test/world.test.ts`,
world art pass)** — the real district code built in Node at both detail
levels, checked vertex by vertex: **nothing solid below head height (2.2 m)
is drawn outside the box it belongs to** (6 cm tolerance; a building split
around its porch counts as one); decoration below head height is flat,
inside some box, or outside the square; **every collision box is visibly
filled** (85 % of its width and depth, 60 % for round lamps and tables), so
there are no invisible walls; every clickable object and chair has its own
highlightable mesh and every building has fade volumes; triangle budgets
(220 000 high, 110 000 low).

**Title screen and several lives through the real room (10 tests,
`server/test/lobby.test.ts`):** create lives from the title screen up to
three (same guest token), the fourth refused, any of them can be entered and
others see the right name and look; each life keeps its own needs and money;
back to the title and in again at the same spot, and the character still
moves; pressing Continue twice enters once (`busy`/`in_world`); a network
drop at the title screen keeps the session; **changing the look from the
title screen and in the world leaves needs, wallet, ledger, skills, traits
and position untouched** (database rows compared); deleting only from the
title screen, with the name typed, never while the character is played in
another window, removing its rows; another profile can't see, play, change
or delete a character (`character_not_found`); malformed title-screen
requests refused; a window entering the world takes over from a window
playing another life of the same profile (4100).

**End to end, the district (`e2e/world.spec.ts`, world art pass)** — two
players, one at full detail (`?quality=high`) and one at the light level:
the district is built at both levels within its triangle budgets (the
build time, meshes, triangles and draw calls are logged as `[world perf]`);
from beside the café kiosk, tapping a plane tree's trunk is refused with
"Plane tree: you can't walk there."; a café table offers Study and Sit,
the character walks over and sits on one of its chairs, and the other
player sees the seat taken; walking into the portico fades the houses above
(`building:portico`), the walkway is walked end to end behind the columns,
and stepping out brings them back. Every walk target is checked to be on
screen and not hidden before it is tapped, and the camera is left to
settle after each walk.

**End to end, title screen (`e2e/title-flow.spec.ts`)** — the title menu
(five items, Continue disabled without a life, the not-affiliated notice);
Settings stored in the browser and applied (reduced motion, camera speed,
hidden controls reminder, graphics "Performance" taking effect after a
reload); Credits; New life: a name is required, at most two traits, going
back from the look keeps name and look, the review lists name, traits and
one line per category, "Change" jumps back to that category, Begin enters
the world with the chosen look and traits. Returning players: Continue
names the last played character with a portrait; a second life from the
character list; most recently played first; editing from the title screen
with Cancel asking before discarding (nothing saved), then saving through
the review ("Changes to save: Hair."); deleting with the typed name; another
player sees the saved look. In the world: Cancel changes nothing; Save
changes the look but not money, ledger, skills or traits (needs within
normal drift); **a simulated network drop reconnects into the same
character with the same look**; a reload returns through Continue. Phone
(390×844 touch, then 844×390): every menu item, category tab and footer
button on screen, menu items at least 44 px tall, preview above the
categories, **one-finger drag turns and a two-finger pinch zooms the
preview**, creating and editing work by tapping, and the creator sits side
by side in landscape.

**End to end, character creator (`e2e/creator.spec.ts`, M6)** — in the real
creator with its live WebGL preview: **every hair style, every top and every
eye shape produces a different preview image** (canvas screenshots compared),
and a hair change rebuilds only the head while a top never rebuilds it;
choosing a headscarf then another hair style keeps the choice, labels it
"Covered by the headscarf", and the preview stays identical (it doesn't
pretend), until the headscarf comes off; a full outfit labels the top as
covered; presets apply and show thumbnails; undo/redo; randomise all;
reset one tab leaves the others; hold-to-compare shows the starting look;
look codes copy, apply and refuse invalid codes. Phone (390×844, touch):
preview above the controls, no sideways scrolling, tapping a preset and a
skin-tone stop, creating the character; the saved look matches. Four
browsers with diverse presets: every player sees every other player's exact
look; each character stays under 30 000 triangles and 14 meshes; a picture
of them together is saved to `test-results/m6-diverse-plaza.png`.

**Character lab (`client/lab.html`, manual)** — renders every preset, hair
style (front and back), hairline, facial hair, top, bottom, full outfit,
pattern, outerwear, shoes, headwear, glasses, skin-tone stop, undertone,
build, body and face slider extreme, and walk/seated/greeting poses, with
triangle counts and build times. Used for the visual checks in the results log.

**End to end, persistence (`e2e/persistence.spec.ts`)** — create a character
with chosen options, walk, reload: the title screen offers "Continue as
Giulia", and Continue brings back the same name, look, position and guest
token; edit the look via clicking yourself (review lists "Hair, Clothing"),
another player sees the change, still there after a reload; a second tab
only showing the title screen disconnects nobody, Continue there takes the
character over and the first tab shows "Playing in another window", with
only one copy in the world; an unrecognised saved token is discarded and
the title screen explains why.

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
| 2026-10-19 (M6c, world art pass) | typecheck + build | Pass | shared, server, client (including `client/test`); production build with three entries (game, character lab, world lab); the district code is its own 63 KB chunk (23 KB gzipped) |
| 2026-10-19 (M6c) | unit + integration | 216/216 pass | Includes the new layout tests (`shared/test/world.test.ts`) and art-against-collision tests (`client/test/world.test.ts`), and every existing server test on the new layout. One earlier full run had one failure in the life-loop test that did not repeat (4/4 alone, then the full suite passed twice). The database and persistence code did not change in this milestone, so the PostgreSQL runs were not repeated |
| 2026-10-19 (M6c) | e2e | 19/19 pass (final, by file) | First full run at full detail: the four-browser creator test timed out (a third software-rendered browser waited over 60 s at the welcome screen), so test browsers now default to the light detail level (`VITE_DEFAULT_QUALITY=low`; see notes below). Second full run: all 18 existing tests pass in the new district; the new district test failed on its own test route (the café kiosk, then a portico column, hid the spot it tapped). Fixed in the test (a route checked by probing every point from the arrival area, on-screen checks, waiting for the camera, a choice of spots between the columns); then 3/3 consecutive passes |
| 2026-10-19 (M6c) | manual visual check (Claude, screenshots) | Pass with known limitations | World lab: every viewpoint (overview, game camera, hall, porch, library, portico, café, market, fountain, north street, south side, skyline), the collision overlay and the light detail level; in the game at 1366×800, 390×844 and 844×390 touch, walking to the café, under the portico (fading) and north. Limitations listed under "Known issues". Not yet seen by the product owner, on Windows or on a phone |
| 2026-10-19 (M6b, title screen) | typecheck + build | Pass | shared, server, client; production build 925 KB of JavaScript (259 KB gzipped) plus 81 KB of WOFF2 fonts |
| 2026-10-19 (M6b) | unit + integration | 198/198 pass (final) | With `TEST_DATABASE_URL` on a throwaway PostgreSQL 16.15: 222/223 on the last full run; the one failure was test timing (a title-screen test read the shared state before the patch removing the player arrived; the test now waits for it), then `lobby.test.ts` 10/10 twice on both backends. An earlier full run had a similar timing failure in "pressing Continue twice enters once" (fixed the same way). Includes migration 0004 up, refused rollback with two characters, rollback with one, and up again, on PGlite and PostgreSQL |
| 2026-10-19 (M6b) | e2e | 18/18 pass (final, by file) | Three full runs on the in-memory database: 13/18, 15/18, then 17/18. Run 1: two test mistakes (a review line is "Rounded afro", not "Afro"; a layout check measured during the screen's slide-in) and two- to four-browser tests over their time limits. Run 2: three multi-browser tests just over 150 s, so those now allow 300 s and the four-browser test 900 s; starting-look portraits are now drawn as they scroll into view instead of all 17 at once. Run 3: only the desktop life test failed, because the café counter landed a few pixels under the character panel's edge depending on where the walk ended; the test now stops closer to the counter in two steps and waits for the camera to settle: 3/3 re-runs pass. Title-screen spec re-run 4/4 after the last CSS change. Title-screen and persistence specs also on PostgreSQL 16.15 (`E2E_DATABASE_URL`): 8/8; rows checked with SQL (migration 0004 applied, `characters_by_account` index in place of the one-per-account index, every character with its appearance, needs, wallet and position rows, no ledger rows left by deleted characters) |
| 2026-10-19 (M6b) | manual visual check (Claude, screenshots) | Pass | Every screen at 1366×800, 390×844 touch and 844×390 touch: title (first visit and returning), name and personality, creator (each category), review, welcome transition, world, character panel, character list, edit look and its review, delete confirmation, Settings, Credits. Not yet checked by the product owner, on Windows or on a real phone |
| 2026-10-19 (M6b) | problems found while testing | Fixed | (1) Phone: six category tabs truncated their names; now two rows of three. (2) Title: stars behind the logo and menu hurt legibility (now faded there), keyboard focus jumped when the menu re-rendered, and the footer notice was hard to read. (3) Animated stars cost about 1.9 CPU cores with software rendering (measured), so the sky is now still; the loading bar no longer repaints the sky. (4) The review turntable is capped at 30 fps. (5) Phone landscape: the "SIM" badge touched the logo |
| 2026-10-19 (M6) | typecheck + build | Pass | shared, server, client; production build with the game and the character lab as two entries (880 KB, 245 KB gzipped) |
| 2026-10-19 (M6) | unit + integration | 179/179 pass | `npm run check` (shared 94 incl. 25 new appearance tests; server 85 incl. new upgrade, migration-rollback and boundary tests). Database tests with `TEST_DATABASE_URL` on a throwaway PostgreSQL 16: 48/48 (both backends, incl. migration 0003 up, down with the closest old look, and up again) |
| 2026-10-19 (M6) | e2e | 14/14 pass (after fixes) | Full suite on the in-memory database: 13/14 on the first full run; the appearance-edit test then hit the 60 s default timeout (two software-rendered browsers plus the creator) and got 150 s like the other multi-browser tests; re-run 4/4. Persistence spec also on PostgreSQL 16 (`E2E_DATABASE_URL`): 4/4, rows checked with SQL (profile version 3, `config` v1, M4 columns holding the closest old look) |
| 2026-10-19 (M6) | manual visual check (Claude, character lab screenshots) | Pass with known limitations | Every preset (body and face), every hair style front and back, hairlines, facial hair, every top, bottom, full outfit, pattern, outerwear, shoe, headwear and glasses, all nine skin-tone stops and three undertones, builds and every body and face slider at 0 and 1, walk / seated / greeting poses. No broken geometry found; limitations listed in ASSET_PIPELINE.md. Not yet checked by the product owner |
| 2026-10-19 (M6) | bugs found while testing | Fixed | (1) Sleeveless tops produced NaN arm vertices (division by a zero sleeve length). (2) Locs and braids rooted at the front fell over the face; locks now turn to fall beside it. (3) Skin-tone quick buttons sent 0.375 while the server stores two decimals (0.38): now rounded in the creator. (4) The look-code box closed itself when a preset was applied. (5) A three-step toon ramp left blotchy bands on faces; replaced by a soft ramp. (6) The creator re-rendered every frame; it now renders only when something changes, and the world isn't rendered behind it |
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
  allow 150 s. Since the title screen milestone every browser joins through
  the title screen first, and the two- and three-browser tests needed just
  over 150 s on this machine: they now allow 300 s (the four-browser diverse
  characters test 900 s). On a normal PC with a graphics card they take a
  fraction of that.

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
  - Characters can be deleted (since M6b); deleting a whole guest account,
    and cleanup of abandoned guest accounts, don't exist yet.
  - Guest-creation limit and session registry are in memory, per server process.
  - Activity, seats and pending actions are not saved; after a reload the
    character stands at the spot it would stand up to.
  - Up to three characters per guest profile (D-031); name and age can't be
    changed after creation.
  - Not tested: a real phone, Windows, Firefox, Safari; profile room tests run
    on PGlite only (the database layer and the persistence and title-screen
    browser tests were also run on real PostgreSQL).
- **M3 interaction limitations:**
  - One action at a time; a new request replaces the current one (D-011). No multi-action queue.
  - Poses are simple procedural limb rotations (since M6): walk, sit, study,
    sketch, wave, café and fountain actions; no blending between poses.
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
- Rendering performance measured only on this cloud machine with software
  WebGL (geometry budgets per character are enforced by e2e; see
  ASSET_PIPELINE.md "Measured cost"). No frame-rate measurement on a real
  GPU or phone yet, and no frame-time budget.
- Load beyond 4 simultaneous players not tested.
- **M6 character limitations:** procedural Stage-1 art, not artist-made
  models (D-027; visual limitations in ASSET_PIPELINE.md); no level of detail
  for distant characters; each new or changed character is built on the main
  thread in one go (a short stall per player joining); looks saved in the
  browser (`localStorage`) are a per-browser convenience only; the "no WebGL"
  message in the creator has no automated test; opening the creator takes
  several seconds in software-rendered test browsers (shader compilation),
  not measured on real devices.
- **M6b title screen limitations:**
  - Sessions at the title screen still receive the shared room state (other
    players' positions) and count toward the room's player limit; the client
    builds no avatars for them until it enters. Interest management later.
  - Entering the world takes about 4 s on this machine with software
    rendering (0.9 s server, 2.4 s first world frame, 1.25 s welcome
    screen); not measured on a real GPU. Shaders are not precompiled yet.
  - The fallback that draws a default body part when a part can't be built,
    the portrait fallback without WebGL and the creator's no-WebGL message
    have no automated test.
  - Device settings and saved looks live in one browser only. The Graphics
    setting applies after a reload.
  - The review turntable renders continuously (capped at 30 fps) while the
    review step is open; menus are otherwise still (the star sky is not
    animated: it cost 1.9 cores in software rendering, see results log).
  - Two windows of the same profile at the title screen can show slightly
    stale lists (e.g. after a deletion in the other window); every action is
    checked by the server, which refreshes the list on a stale request.
  - A rare race: if one window deletes a character at the exact moment
    another window of the same profile enters the world with it, the second
    window can play a character whose saves then fail (logged). Both checks
    run before the delete, so this needs two windows acting within
    milliseconds.
- **World art pass limitations:**
  - The district is Stage-1 procedural art (D-033): no interiors behind
    doors and windows, faceted tree canopies, still water, colour-striped
    roof tiles. Not yet seen by the product owner.
  - No day/night lighting: the light is always afternoon while the hall's
    clock and the HUD follow the game clock (often night). Lamps don't
    light up.
  - A faded building shows its nearest surface at 16 % opacity; when the
    camera is inside a building (near the edges, or under the portico) the
    view looks busy. No camera collision yet.
  - On arrival the camera stands in the street south of the square, 3 m
    from the shops, so their wall fills the right of a computer screen
    until you walk or turn. Options for the owner: fade buildings very close
    to the camera, or move the arrival points about 3 m north.
  - Frame rate on a real graphics card or phone is not measured; on the
    cloud machine (software rendering) a full-detail full-window frame takes
    hundreds of milliseconds, which is why the browser tests default to the
    light detail level (see "Notes for running tests").
  - Taps pass through tree canopies, awnings and parasols (only the solid
    parts have tap boxes), so tapping a canopy walks to the ground behind it.
  - Saved characters standing where a new prop now is are moved to a spawn
    point on their next visit (by design; not covered by its own test).
- `npm audit` reports 9 low/moderate advisories, all inside `@colyseus/auth`
  (pulled in by the SDK, unused by this project). The suggested `--force` fix
  would downgrade Colyseus to 0.15, so it was not applied. Recheck on Colyseus updates.
- Client bundle is about 930 KB (259 KB gzipped), mostly Three.js, plus about
  80 KB of fonts loaded once; code splitting is a later optimisation.

## Notes for running tests in Claude's cloud workspace

- Playwright's browser download (`cdn.playwright.dev`) is blocked there. A
  Chromium is preinstalled; run the e2e suite with
  `CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npm run test:e2e`.
- Use absolute paths (`/home/claude/padova-life-sim`): `~` in the shell resolves
  to `/root`, not the project's parent folder.
- The Colyseus startup banner appears in test output; it is cosmetic.
- The browser tests build the client with `VITE_DEFAULT_QUALITY=low`, so
  every test browser draws the light world (no shadows, fewer details)
  unless a test asks for `?quality=high` (`e2e/world.spec.ts` does, for one
  player). Collision, tap boxes and gameplay are identical at both levels.
  Reason: since the world art pass, three or four software-rendered
  browsers drawing the full-detail district at once on 2 CPUs could not
  finish a frame fast enough (a third player waited over 60 s at the
  welcome screen). `E2E_QUALITY=high npm run test:e2e` runs every browser
  at desktop detail on a machine with a real GPU.
- Don't edit files under `client/` or `shared/` while the browser tests run:
  the test client is Vite's dev server, which reloads the page on a change and
  makes the running test fail (seen once during the title screen milestone).

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
    Walk somewhere, then reload the page: the title screen says *Continue as
    <name>*; Continue brings back the same look at the same spot.
12. Tap yourself (standing) → **Edit look**, change the hair colour, Review,
    Save look. The other device sees the change; reload and it is still there.
13. Stop the server (Ctrl+C), start it again, reload: the character is still there.
14. Open the game in a second tab of the same browser and press Continue: the
    character moves to the new tab and the first tab says "Playing in another
    window".
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
19. **Characters (M6):** in a private window, New life → name → the character
    creator opens with a 3D preview. Drag the preview to turn it; try Body / Upper / Face. Pick a
    few presets, then change the skin-tone slider end to end, the hair style
    (every style must look different), a face shape and an outfit. Undo and
    Redo work; *Hold to compare* shows the starting look.
20. Choose **Headscarf** under Accessories → Headwear, then change the hair style:
    the hair stays covered and the creator says "Covered by the headscarf".
21. Create the character, walk, sit on a bench and greet someone: the new
    character walks, sits and waves. The other device sees exactly the same
    look; reload and it is still the same. On the phone the preview is on top
    and the controls scroll below.
22. **Title screen:** the title shows New life, Continue, Manage characters,
    Settings and Credits over the starry sky and porticoes; Continue names
    your last character with its portrait. Keyboard: Tab / Enter work and
    Escape goes back on every screen.
23. In New life, try **Next** without a name (an error asks for one), pick
    two traits (a third is disabled), go to the look, then **Back** and
    **Next** again: name, traits and look are kept. On **Review**, press
    *Change* on Hair: it opens the Hair category. **Begin life in Padova**:
    a "Welcome to Padova" screen, then the piazza.
24. Character panel → **Back to title** → **Manage characters**: create a
    second life, then edit the first one's look and press **Cancel**: you
    are asked before changes are thrown away, and the look is unchanged.
    Edit again, Review lists the changes, **Save look**.
25. **Delete** the second life: the button stays disabled until its name is
    typed. Afterwards one life is left.
26. **Settings:** choose Reduced animation (menus stop moving, the review
    turntable stops), Fast camera speed (dragging turns further), hide the
    controls reminder (gone in the piazza); Graphics: Performance, then
    Reload now: shadows are gone.
27. **Phone, portrait and landscape:** every title screen fits without
    sideways scrolling; in the creator all six categories are visible, one
    finger turns the character and two fingers zoom; Review and Begin are
    reachable without hunting; turning the phone keeps everything usable.
28. **The district (world art pass):** walk round the square. Nothing you can
    see should let you walk through it (trees, lamps, chairs, planters,
    stall poles), and you should never stop at something invisible. Report
    the spot if either happens (the coordinates are in the browser console
    with `__padova.players()` on a `?e2e` page).
29. Walk into the university hall's porch (between the two study desks) and
    along the portico on the east side behind its columns: the portico
    houses fade while you are under them, then come back.
30. Tap a tree, a lamp and a street planter: each says what it is and that
    you can't walk there. Tap a café table: Sit / Study; sit on a chair;
    another player sees you seated there.
31. Walk to the south edge and turn the camera to look south: the building
    between the camera and you fades. The clock on the hall's tower shows
    the same time as the clock chip.
32. On a phone, check the frame rate feels smooth in the square (graphics
    "Automatic" picks the lighter detail there).
