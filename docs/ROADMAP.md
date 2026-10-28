# Roadmap

Each milestone must end with something demonstrably working on desktop and phone.
Statuses: planned · in progress · blocked · implemented · tested · verified.
**Proposed** means designed for discussion and not approved or started.

| # | Milestone | Status | Acceptance (summary) |
| --- | --- | --- | --- |
| M0 | Foundation | Tested | Repo, workspaces, docs, typecheck/test commands, scene loads on desktop and mobile emulation |
| M1 | Walkable world | Tested | Greybox piazza, third-person camera, click/tap-to-move with pathfinding, WASD, joystick, collision |
| M2 | Real multiplayer | Tested | Server-authoritative movement, join/leave, interpolation, reconnection, 2 desktop + 1 mobile-emulated browser |
| M3 | Interaction system | Tested | Select objects and players; contextual menu (desktop radial, mobile sheet); server-validated walk-to-then-act (bench sit/stand, desk study/sit, greet) |
| M4 | Identity and persistence | Tested (persistence verified) | Temporary guest identity, PostgreSQL with migrations, versioned character profile, appearance and position restored after reload and server restart |
| M5 | Life simulation | Tested (persistence verified) | Server game clock and offline rules; five needs; mood with reasons; five skills; four traits; money ledger with server-validated café purchases; character panel; the complete café → eat → study → reload loop |
| M6 | Characters | Tested (persistence verified); Stage-1 procedural art | Versioned appearance config; procedural anime-inspired characters for every option (skin tones, 17 hair styles, face, body, wardrobe); character creator with live 3D preview; saved, upgraded from M5, replicated. Authored (artist-made) models not available yet (D-027) |
| M6b | Title screen and character creation flow | Tested (persistence verified on PGlite and PostgreSQL 16); real phone and Windows not yet | Title screen (New life, Continue, Manage characters, Settings, Credits); up to 3 lives per guest profile (D-031); new life in three steps (name and personality → live 3D look in six categories → review and confirm); entering transition; edit a look from the title screen or the world without touching life data; original menu identity (D-032) |
| M6c | World art pass: the first district | Tested (see acceptance below); Stage-1 procedural art; not yet seen by the product owner, on Windows or on a phone | The greybox becomes a fictional Padua-inspired university square: six detailed buildings (hall with walk-in porch and clock tower, library, portico you can walk through), market, café with tables, gardens, trees, lamps, paving; streets and skyline beyond; collision-first art checked by a test; buildings and trees that hide you fade (D-033, D-034) |
| M7 | A first job | Tested (persistence verified on PGlite and PostgreSQL 16); numbers not yet play-tested; real phone and Windows not yet | Café kiosk job: ask about work, 90 s shifts on two staff spots behind the counter, a wage paid once per completed shift through the M5 ledger, barista grade at communication level 2, opening hours and a daily limit, quit; daily allowance halved (D-035, D-036) |
| M7b | Day and night | Tested (world lab, the game at night on desktop and phone emulation); Stage-1 art; not yet seen by the product owner, on Windows or on a phone | Sun and moon, sky, haze, stars, lit windows, lanterns and lamplight pools follow the shared game clock; night stays readable; 2 extra draw calls at night only; no gameplay effect (D-037) |
| M7c | Indoor rooms: the foundation | Tested (persistence verified on PGlite; desktop and phone emulation); Stage-1 art; not yet seen by the product owner | Areas inside the one server room, doors, only your area's players sent to you, the area saved; the hall's lecture room and the library's reading room (D-039) |
| M8 | University basics | Tested (persistence verified on PGlite and PostgreSQL 16); numbers not yet play-tested; real phone and Windows not yet | One fictional course: enrol at the notice board beside the hall, lectures on the hour on weekdays in the lecture room, two exam sittings a week, a grade computed on the server from attendance, study and academic level; fail and retake; all private and saved (D-040) |
| M9 | Relationships, public profiles and safety | Tested (persistence verified on PGlite and PostgreSQL 16); numbers not yet play-tested; real phone and Windows not yet | Player cards, *Chat*, friendships grown from greetings, chats, studying and lectures together; blocks and reports between accounts (reports deleted after 90 days, `npm run reports`); a private story log (D-042, D-043) |
| M10 | A place to live | Tested (persistence verified on PGlite and PostgreSQL 16); numbers not yet play-tested; real phone and Windows not yet | A rented room in the student housing (weekly rent, grace period, cheaper room, never debt), sleep, comfort, a small furniture catalogue in fixed spots, storage |
| M11 | NPCs with routines | Tested (desktop and phone emulation; tick budget measured); not yet seen by the product owner | Four deterministic locals (a barista, three students) on game-time schedules, using the same movement, seats and actions as players; greet them; tick time measured against a budget |
| M12 | Sign-in, deployment and operations | Part 1 tested (deleting a guest profile, health and status, JSON logs, a load test; D-046); sign-in, hosting and the admin page wait for Q15 and Q16; before people outside the project play (D-035) | Real sign-in, account deletion, hosting with backups, HTTPS/WSS, monitoring, a load test |

After M7: **playable multiplayer prototype** (earn and spend). The order
M7 → M7b → M8 → M9 → M10 → M11 was approved on 2026-10-20 (D-035), with M12
before any public test; each milestone's acceptance criteria and
dependencies are in "Planned milestones" below. More districts come after
the systems that give them a purpose.

## M0–M2 walking skeleton: acceptance criteria

| Criterion | Status | Evidence |
| --- | --- | --- |
| `npm install` + one dev command starts client and server | Tested on Linux only | Manual run of `npm run dev`: client served the page, server accepted a matchmaking request. Clean `npm ci` + `npm run check` from the packaged repo passed. Windows pending (open item 2) |
| Two desktop browsers and one phone see each other move smoothly | Tested (phone = emulation) | e2e test; real phone pending (manual checklist in TESTING.md) |
| Server rejects illegal moves (teleport, walls) | Tested | Integration tests: forged positions ignored, blocked targets rejected, speed capped |
| Closing a tab removes the player for everyone | Tested | e2e final step |
| Brief connection loss reconnects to the same character | Tested | Integration test with simulated drop |
| Automated two-browser test passes | Tested | e2e (3 browsers) |

Not yet **verified**: needs a run on a real phone and the product owner's sign-off.

## M3 interaction system: acceptance criteria

| Criterion | Status | Evidence |
| --- | --- | --- |
| Click/tap an object to select it, with a clear highlight | Tested | e2e desktop + mobile; outline on the selected object, lighter outline on hover (desktop) |
| Click/tap another player to select them | Tested | e2e: Alice selects Bruno (desktop); Chiara selects Dario (mobile) |
| Own avatar is never selected as another player | Tested | e2e: clicking yourself standing selects nothing; seated, it opens the seat's menu (Stand up) |
| Desktop contextual menu (radial), dismissed or updated on selection change | Tested | e2e: menu opens with only valid options; Escape and taps elsewhere close it; options refresh when seats change (code path, not separately tested) |
| Mobile action sheet with large buttons, portrait and landscape | Tested (portrait, emulation) | e2e: buttons ≥ 48 px tall; joystick hidden while the sheet is open in portrait. Landscape layout (sheet docked right, joystick kept) has CSS but no automated test |
| Server validates target, distance, reachability, state, permissions | Tested | Integration: unknown target, wrong action, self-target, too far (tuned limit), unreachable (walled world), full bench, malformed payload |
| Walk to the interaction point, then execute | Tested | Integration + e2e: queued → started → completed; seated position equals the seat |
| Progress and cancellation | Tested | e2e Cancel button; integration cancel frees the reserved seat; movement interrupts actions |
| Meaningful errors | Tested | Rejection reasons asserted in integration tests; toasts in the client (`ui/reasons.ts`) |
| Simultaneous interactions and disconnects | Tested | Integration: two players racing for one desk seat (one wins), three for a two-seat bench, seat kept through a drop and freed on leave, greet target leaving mid-walk |
| Client cannot claim completion | Tested | Integration: forged completion messages ignored; study finishes on the server timer |
| Bench sit/stand, greet, desk sit/study | Tested | All four actions covered by integration tests; desk menu and cancel covered in e2e |

Not yet **verified**: real phone, Windows, and the product owner's sign-off.

## M4 identity and persistence: acceptance criteria

| Criterion | Status | Evidence |
| --- | --- | --- |
| Versioned profile: character id, account id, name, age category (adult vs non-adult), appearance (preset, hair, eyes, skin, outfit), timestamps, schema version | Implemented, tested | `characters` + `character_appearance` tables; `PROFILE_VERSION` with upgrade steps; shared and database tests |
| Gameplay data kept separate from the profile | Implemented | Saved position in `character_state`; future systems get their own tables (DATA_MODEL "Rules to keep") |
| Create a profile | Tested | Integration + e2e: first visit → form → character stored with a guest account in one transaction |
| Load it in a later session | Persistence verified | Integration; e2e reload; manual server restart on on-disk PGlite; e2e on real PostgreSQL 16 |
| Save valid appearance changes | Tested | Integration + e2e: saved, replicated to others, kept after reload |
| One player cannot modify another's profile | Tested | Integration (forged ids ignored) + database tests (owner-scoped SQL refuses other accounts) |
| Invalid or outdated data handled safely | Tested | Malformed payloads, unknown option ids, retired options repaired on load, newer-version profile read-only and never overwritten |
| Preserved across reloads and reconnects | Tested | e2e reload; integration network drop; regression test for leave-and-rejoin race |
| Multiple sessions of the same player | Tested | Newest session wins (D-018); e2e second tab; integration eviction |
| Temporary guest identity, safe within the architecture | Tested, temporary by design | Hashed 256-bit token, checked before joining, never trusted ids; limitations documented (D-017) |
| No database credentials in the browser | Verified by design | `DATABASE_URL` read only by the server; the client never receives it |
| Migrations tested | Tested | Up, idempotent re-run, rollback and re-apply on PGlite and PostgreSQL 16 |

Not yet **verified** by the owner: real phone, Windows, sign-off.

## M5 life simulation: acceptance criteria

| Criterion | Status | Evidence |
| --- | --- | --- |
| Needs 0–100 with defined meanings, rates and consequences; not punishing | Implemented, tested | GAME_DESIGN "Life simulation"; unit tests incl. "nothing empties in under 90 real minutes"; consequences are gentle (mood, slower learning, "too tired" below 10 energy, halved greeting gain when grubby) |
| Mood derived from needs and recent events | Implemented, tested | `shared/src/life/mood.ts`; unit tests; reasons shown in the panel (e2e screenshots: "Good meal +10", "Learned something +8") |
| Five skills improved by appropriate actions | Implemented, tested (cooking has no source yet) | Academic (study), creativity (sketch), communication (greet), fitness (walking); integration + e2e. Cooking waits for a kitchen |
| Skills eventually unlock opportunities | Started in M7 | Levels exist (max 10); communication level 2 makes café shifts pay the barista wage (M7, tested). More unlocks come with M8 and M10 |
| Small deterministic trait system | Implemented, tested | Organised, Sociable, Creative, Ambitious; chosen at creation (up to 2); unit tests; Organised learns 15–25 % more (integration) |
| Finances: balance, income, expenses, purchase history; no negative balance; server-validated | Implemented, tested, persistence verified | Ledger tables with CHECK constraints; row-locked idempotent `applyMoneyChange`; database tests on PGlite and PostgreSQL 16 incl. simultaneous purchases; prices only from the server menu |
| The complete loop (enter → inspect → café → buy → eat → study → see changes → reload keeps progress) | Tested | Integration test (fast tuning) and e2e test with the real durations in a real browser |
| Time model documented before the clock; frame-rate independent; offline rules; no per-client timers | Implemented, tested | D-021/D-022 written first; clock derived from server real time and replicated; offline catch-up capped at 8 game hours; integration test at scale 600 |
| Compact character panel, desktop and mobile, not covering most of the view | Tested (desktop + phone emulation) | e2e: ≤ 30 % of the width on desktop; bottom sheet < 50 % of the height on a Pixel 7 profile |
| Tests: needs, skills, purchases, insufficient funds, repeated requests, validation, save/load, time | Tested | 150 unit/integration tests (see TESTING.md); 9 browser tests |

Not yet **verified**: real phone, Windows, play-testing of the balance, and the product owner's sign-off.

## M6 diverse modular characters: acceptance criteria

| Criterion | Status | Evidence |
| --- | --- | --- |
| 1. Visibly distinct characters across a broad range of skin tones and appearances | Tested, visually checked | Continuous tone slider (9 named stops, 3 undertones); 17 presets spanning very fair to deep brown; character lab screenshots of every preset, tone stop and undertone checked by eye; e2e picture of diverse players together |
| 2. Hairstyles with genuinely different textures and silhouettes | Tested, visually checked | 17 styles across straight, wavy, curly, coily, tightly coiled; every style is its own geometry; e2e: every style produces a different preview image |
| 3. Facial and body customisation within the model's capabilities | Implemented, visually checked | Face shape, eyes, brows, nose, lips, cheekbones, jaw, chin, forehead; body frame, six builds, height and proportions; slider ranges clamped (lab renders every slider at 0 and 1). Procedural model: no rig, so no facial expressions |
| 4. Free combination, no ethnicity restriction | Tested | No ethnicity field anywhere (unit + boundary tests); every option combines with every other; randomiser can produce every option of every field |
| 5. Survives save, reload, reconnection | Persistence verified | Integration (save, reload, network drop, M5 upgrade) on PGlite; database tests on PGlite and PostgreSQL 16; e2e reload |
| 6. Others see the correct appearance | Tested | Integration and e2e: decoded `look` equals the saved config on every client |
| 7. Missing assets / invalid configs fail safely | Tested (one path untested) | Strict validation names the field; stored data repaired with a notice; unreadable looks draw the default; newer profiles read-only. No WebGL → explanatory message instead of an empty creator (implemented, not tested) |
| 8. Desktop and mobile interfaces usable | Tested (emulation) | e2e desktop creator and a 390×844 touch phone; real phone not tested |
| 9. Movement, collision, animation, interactions still work | Tested | Full existing e2e and integration suites re-run; walk, sit, study, greet poses on the new characters (collision radius unchanged) |
| 10. Automated checks pass; assets manually verified | Tested; visual check by Claude only | See TESTING.md results log. There are no authored assets: the procedural characters were checked in lab screenshots, not yet by the product owner |

Not yet **verified**: the product owner's own look at the characters, a real
phone, and Windows.

## M6b title screen and character creation: acceptance criteria

| Requirement | Status | Evidence |
| --- | --- | --- |
| 1. Title screen with New Life, Continue, Character Management, Settings, Credits | Tested | e2e `title-flow.spec.ts`: five items, Continue disabled without a life and naming the last played character with a portrait; Manage characters, Settings, Credits open and Escape returns |
| 2. Naming and initial setup | Tested | Name required (2–20 characters, checked again by the server), up to two personality traits, adult notice; going back keeps the values |
| 3. Live 3D character creation | Tested | The real procedural characters (M6). Six categories: Appearance (starting looks, skin), Face, Hair, Body, Clothing, Accessories. Drag/touch to turn, wheel/pinch/buttons to zoom, randomise all or one category, reset a category, undo/redo, hold to compare |
| 4. Final review and confirmation | Tested | Review step: turntable, name, traits, one plain line per category with "Change"; nothing is sent before "Begin life in Padova" / "Save look"; edits list what will change |
| 5. Transition into the shared world | Tested | "Welcome to Padova" with the time of day, waits for the world's first frame, then uncovers it |
| 6. Diverse starting presets, free combination, no ethnicity restriction | Tested (from M6) | 17 presets named by look; every field independently changeable; no ethnicity field (D-029) |
| 7. Only functioning options shown; missing assets and unavailable options handled | Implemented; partly tested | Every catalogue option has renderer code (M6 tests); covered choices labelled (tested). If a body part can't be built, the default part is drawn and the player is told (implemented, not tested: no way to break a part on purpose yet); portraits fall back to the initial without WebGL, and the creator explains a missing WebGL (implemented, not tested); Settings shows only working settings |
| 8. Desktop mouse and keyboard; mobile touch, portrait and landscape; no hover / right-click / keyboard-only requirement | Tested (emulation) | e2e desktop flows; 390×844 and 844×390 touch: everything on screen, 44 px targets, one-finger turn and two-finger pinch on the preview, tapping through creation and editing. Hover only previews starting looks (tap applies them); keyboard: Tab/Enter, arrow keys in the categories and on the preview, Escape = back. Real phone not tested |
| 9. Saved through the existing persistence layer; same look in the world; other clients see it | Persistence verified (PGlite and PostgreSQL 16) | Integration and e2e: create, reload → Continue, others see the decoded look; database tests and the title-screen and persistence browser tests also on PostgreSQL 16, rows checked with SQL (see TESTING.md) |
| 10. Changing cosmetics later never resets needs, money, skills, inventory or relationships | Tested | Integration: database rows for needs, wallet, ledger, skills, traits and position identical before and after a look change (title screen and world); e2e: money, ledger, skills, traits unchanged. Inventory and relationships don't exist yet |
| 11. Cancellation, reconnecting, multiplayer replication, mobile usability tested | Tested | e2e: Cancel asks before discarding and saves nothing; simulated network drop reconnects into the same character; reload → Continue; another player sees the saved look |

Not yet **verified** by the product owner: the screens on Windows and on a
real phone, and the art direction of the new menus.

## M6c world art pass: acceptance criteria

| Requirement (from the brief) | Status | Evidence |
| --- | --- | --- |
| Replace the box placeholders with a cohesive, detailed, stylised university district inspired by Padua | Implemented; checked by Claude from screenshots | Six buildings with windows, doors, shutters, balconies, cornices, roofs and signs; one palette and one toon material (D-033); world lab screenshots of every viewpoint. Not yet reviewed by the product owner |
| European university architecture, entrances and recognisable silhouettes | Implemented | University palazzo with a rusticated ground floor, banners, porch and clock tower; neoclassical library with pediment and dome; portico; skyline with a bell tower, keel-roofed hall and domes |
| Plazas, paths, benches, streetlights, trees, landscaping | Implemented | Paving with sidewalks, cobbled streets, fountain rings; five benches, seven lamps, seven plane trees, two gardens, lemon-tree planters |
| Café exteriors and outdoor seating | Implemented, tested | Café kiosk with canopy and sign; three café tables with parasols and chairs (interactable: sit, study); tiled terrace; shopfronts with awnings |
| Start with the piazza and its surroundings, not the whole city | Done | One district; streets beyond the square are scenery that ends at buildings |
| Keep coordinates, walkable bounds, collision rules, pathfinding and spawn behaviour compatible | Tested | Same 48 × 48 m square, grid A*, spawn points and every interactable's id, position and seats (checked: seat data identical before and after); intentional changes listed in D-034; all existing unit, integration and browser tests run against the new layout (see TESTING.md) |
| Interactive props with stable ids and explicit interaction metadata | Tested | Twelve interactables (id, kind → actions, label, interaction points); chairs `partOf` their table; shared layout tests check ids, labels and links |
| Visible geometry matches collision; no blocking decoration, no invisible walls | Tested | `client/test/world.test.ts`: every solid piece below 2.2 m inside its box, every box visibly filled, at both detail levels; `shared/test/world.test.ts`: no overlapping boxes, no cut-off pockets; collision overlay in the world lab |
| Click/tap-to-move and camera controls preserved | Tested | e2e walking, interaction, life and title tests (results in TESTING.md) |
| Modular, reusable assets with documented formats, licences, dimensions, material conventions | Implemented | Kit in `render/world/kit.ts`; conventions in ASSET_PIPELINE.md "World"; all original, nothing licensed or downloaded |
| Level of detail, texture sizes, instancing/merging, culling, loading for mobile | Implemented; measured on the cloud machine only | Two detail levels by quality profile (low: about 63 000 triangles, no shadows, 31–47 draw calls); 2 small canvas textures; 8 000+ pieces merged into 47 meshes, cobbles and distant windows in single batched geometries (merging instead of GPU instancing: everything is static); per-mesh frustum culling; built after the title screen appears. Frame rate on real hardware not measured |
| No unlicensed assets; placeholders not called production assets | Done | Generated in code; labelled Stage-1 procedural art in code, docs and README |
| One complete walkable district with plaza, a building entrance, seating, vegetation and interactive props | Tested | Walk-in porch and walkable portico reachable (shared tests); benches, café tables, desks, fountain and counter usable (e2e) |
| Movement, collision, navigation, object selection and multiplayer sync still work | Tested | Full unit/integration suite (216/216) and all 19 browser tests (TESTING.md). Test browsers use the light detail level, except one full-detail player in the district test; collision, tap boxes and gameplay are the same at both levels |
| Layout changes documented; asset pipeline docs updated | Done | D-034; ASSET_PIPELINE.md "World"; this table |

Not yet **verified** by the product owner: the look of the district on
Windows and on a phone, and the frame rate on real hardware.

## M7 first job: acceptance criteria

Design and rules: GAME_DESIGN.md "Work (M7)"; choices made while building:
D-036. Test counts and results: TESTING.md.

| Criterion | Status | Evidence |
| --- | --- | --- |
| The café counter offers *Ask about work* (hires at once) and, to employees, *Work a shift* | Tested | Shared menu rules; integration test (hire on arrival, then a shift); e2e desktop and phone. Changed from the plan: an unavailable shift is shown greyed out with its reason instead of hidden (D-036) |
| A shift is a server-timed action at a staff spot behind the counter, with progress and Cancel; its effect on needs is data in `shared/src/life/config.ts` | Tested | `ACTION_EFFECTS.work` (90 s, energy −8, fun −4); integration test checks the staff spot and effects; e2e shows "Working a shift" and the working activity |
| A completed shift pays a wage once, through the ledger, never from a client value; a cancelled, interrupted or dropped shift pays nothing | Tested | Database tests (one payment per shift id, also when recorded twice at once; wage and shift written together); integration tests for completion, Cancel, walking away, leaving, quitting and a network drop |
| Skills matter: working trains communication; communication level 2 pays the barista wage | Tested | Unit tests (grade rule, completion XP); integration tests (a shift adds communication XP; a level-2 character's shift pays €8 as "Wage: Barista") |
| Limits: 4 shifts per game day, 06:00–23:00 opening hours, not while too tired; two can work at once; others see "working" | Tested | Unit tests; integration tests (fifth shift refused, closed café, too tired, two employees and a third refused while customers still buy, a second player sees `working` but never pay); the daily limit is enforced again in the database |
| Employment and wage history survive reload, server restart and network drops | Persistence verified | Integration test across a server restart on one database; e2e reload; a network drop mid-shift pays nothing, keeps the job, and the next shift is paid; PostgreSQL 16 database tests |
| The character panel shows job, grade, wage, next grade, shifts today and opening hours, with *Quit job*, on desktop and phone | Tested (phone = emulation) | e2e desktop panel and Pixel 7 emulation (section reachable, Quit job at least 44 × 44 px, panel under half the screen) |
| Daily allowance €7.50; earned balances untouched | Tested | `ECONOMY_CONFIG.dailyAllowanceCents` = 750; the life integration tests check €100 + €7.50 on entering through the real server; migration 0005 changes no balance |
| Migration 0005 up, down and up again; down refuses while jobs or wages exist | Tested on PGlite and PostgreSQL 16 | `server/test/workDatabase.test.ts` |

Not yet **verified** by the product owner: the job on Windows and on a
phone, and whether the wages, shift length, limits and halved allowance
feel right (play-testing).

## M7b day and night: acceptance criteria

Choices made while building it: D-037. Test counts and results: TESTING.md.

| Criterion | Status | Evidence |
| --- | --- | --- |
| Sun direction and colour, sky, haze and ambient light follow the replicated game minute through dawn, day, dusk and night, as a pure, unit-tested function | Tested | `client/src/render/world/daylight.ts`; `client/test/daylight.test.ts` checks every minute of a day: same minute same light on any day, no jumps (midnight included), sun east → south → west and never below 14°, moonlight at night, 16:00 equal to the art pass's afternoon |
| At night the street lamps, lanterns and some windows light up | Tested | About 40 % of windows (chosen by position), every lantern, shop windows and the pastry case glow; pools of lamplight under the lamps, the kiosk and the porch; stars and a moon. `client/test/world.test.ts` checks the glowing pieces at both detail levels; world lab screenshots at 19:40, 23:00 and 06:20 |
| The square stays readable at night: characters, name tags, menus and tap targets as easy to see as by day | Tested | `e2e/daylight.spec.ts` measures two characters in the picture: at dusk and at night each keeps over 55 % of its midday brightness and over 80 % of its contrast with the ground around it (measured: relative contrast within about 12 % of midday's, one character slightly lower, the other slightly higher). Name tags, menus, rings and highlights are drawn without scene light; tap targets are invisible boxes, unchanged |
| Every player sees the same time of day; joining at night shows night at once, with no flash of daylight | Tested | The light comes only from the replicated minute. `e2e/daylight.spec.ts`: the first frame after entering already used the server's minute, and two players see the same time of day (run by day: the suite's clock starts at 09:00). Joining a server set to 23:00 checked by a script on desktop and Pixel 7 emulation: the first frame was night |
| Both detail levels keep their draw-call and triangle budgets; phones get no extra shadow work | Tested | By day unchanged (86 / 47 draw calls for the overview, 69 / 31 for the game camera, high / low); at night +2 draw calls and about 1 400 triangles at either level (checked in `e2e/daylight.spec.ts`); no new lights or shadow casters |
| No gameplay rule reads the light | Tested | `server/test/boundaries.test.ts`: no file in `shared/src` or `server/src` imports or names the light |
| Checked in the world lab at chosen times, in the game, and by the existing browser tests | Tested | World lab `?time=HH:MM`; the game at night (script above); full browser suite (TESTING.md) |

Not yet **verified** by the product owner: how dawn, dusk and night look on
Windows and on a phone, and whether night is dark enough (or too dark).

## M7c indoor rooms: acceptance criteria

Approach approved as Q14 (option C), choices in D-039, design in
ARCHITECTURE.md "Indoor rooms". Test counts and results: TESTING.md.

| Criterion | Status | Evidence |
| --- | --- | --- |
| Areas inside the one server room; each character in exactly one area; movement, collision and interactions per area | Tested | `server/src/areas.ts`, `PlayerRuntime.area`; `server/test/areas.test.ts` (desks inside work; objects and players of another area are refused) |
| Doors: tap, *Go in*, walk to the door, arrive inside in front of the room's door; *Go out to the square* back | Tested | `shared/test/areas.test.ts` (linked pairs, walkable arrivals, every seat reachable, ids unique across areas); `server/test/areas.test.ts`; `e2e/interiors.spec.ts` on desktop and Pixel 7 emulation |
| Each client receives only the players in its own area, and none at the title screen | Tested | Colyseus `StateView`; spike, then `server/test/areas.test.ts` and `e2e/interiors.spec.ts` (two players out of sight, then together; "1 player here") |
| The area is saved; a reload or reconnection comes back inside; an unknown area falls back to the square | Persistence verified (PGlite) | `server/test/areas.test.ts` (saved row checked; drop and reconnect inside); e2e reload. No database change, so the PostgreSQL runs were not repeated |
| The hall's lecture room and the library's reading room, usable now (study, sit) | Tested | `shared/src/interiors.ts`; e2e studies at a lecture desk |
| Art collision first; rooms readable from the camera | Tested | `client/test/interiors.test.ts` (nothing outside its box, every box filled, own meshes, fade volumes, budgets); camera-side walls and door cut away; screenshots in the world lab and the game |
| The jump through a door is not walking | Tested | Fitness gained across two doors stays under 2 XP in `server/test/areas.test.ts` |

Not yet **verified** by the product owner: the rooms on Windows and on a
phone; the other buildings' rooms come with their uses (D-039).

## M8 university basics: acceptance criteria

Planned below ("M8 — University basics"); design in GAME_DESIGN.md
"University (M8)", choices in D-040. Test counts and results: TESTING.md.

| Criterion | Status | Evidence |
| --- | --- | --- |
| 1. Enrol in one fictional course at the university hall (no real course names, no implied affiliation) | Tested | `COURSES` in `shared/src/life/config.ts` (a test checks the name); the notice board beside the hall's door; `server/test/university.test.ts` (enrol once, refused twice); `e2e/university.spec.ts` on desktop and Pixel 7 emulation |
| 2. A weekly timetable in game time; a lecture can be attended only in its slot and place, checked by the server | Tested | `shared/src/life/university.ts` and `shared/test/university.test.ts` (weekdays, late entry, next lecture across lunch and the weekend); lecture desks only in the lecture room; refusals in `server/test/university.test.ts` (not enrolled, outside the slot, the same lecture twice, late entry closing during the walk) |
| 3. Attendance and study build progress; an exam at a scheduled time gives a grade computed on the server from attendance, study and academic level | Tested | `recordLecture`, `recordStudySession`, `recordExam` (grade computed in the database transaction from stored rows); `server/test/universityDatabase.test.ts` on PGlite and PostgreSQL 16; e2e attends a real 2-minute lecture and sits a real 3-minute exam |
| 4. Neglect has visible but gentle consequences (a lower grade, a retake) | Tested | An unprepared exam fails (12/30) with a mood event, the course stays open, one attempt per sitting, a retake at the next sitting with progress kept (server, database and e2e tests) |
| 5. Timetable, attendance and grades are private, shown in the panel, and persistent | Persistence verified (PGlite and PostgreSQL 16) | Only in the owner's `life` message (a server test checks another player receives none); the panel's University section in e2e; kept after a reload (server and e2e) |
| 6. Tests include time-based rules at a fast time scale and refusals outside the slot | Tested | `server/test/university.test.ts` runs one server at 1 real second = 10 game minutes (late entry closing while walking; lectures in consecutive hours counted separately) and two at the normal clock on a Monday and a Wednesday |

Not yet **verified** by the product owner: the balance (timetable, grade
targets), the notice board and panel wording, on Windows and on a phone.

## M9 relationships and safety: acceptance criteria

Planned below ("M9 — Relationships, public profiles and safety"); design in
GAME_DESIGN.md "Relationships (M9)", "Safety (M9)" and "Story log (M9)";
choices in D-042 and D-043. Test counts and results: TESTING.md.

| Criterion | Status | Evidence |
| --- | --- | --- |
| 1. Tapping another player opens a public panel: name, look, activity and your relationship; never their needs, money or skills | Tested | `client/src/ui/playerCard.ts` (portrait, activity, relationship only); `profileView` answered only to the asker, for players in the same area (`server/test/social.test.ts`); `e2e/social.spec.ts` on desktop and Pixel 7 emulation |
| 2. Relationships grow from shared actions (greetings, chatting, studying together) with a short history; private to the two players | Tested | Rules and caps in `shared/test/relationships.test.ts`; greeting, chat, studying at the same table and attending the same lecture in `server/test/social.test.ts`; daily caps, the 20-moment history and the pair order in `server/test/socialDatabase.test.ts` (PGlite and PostgreSQL 16); a third player receives nothing |
| 3. Block (enforced by the server, both ways) and report (minimal context, deleted after 90 days, also blocks) from the panel and the menu; the owner lists reports with a server command | Tested | Server tests: a block refuses greetings and chats both ways with a neutral reason, ends a chat in progress, survives the blocker's return, can be lifted only by the blocker; a report is stored with its fields, blocks, counts once a day and five an hour; 90-day deletion; `npm run reports` tried on an empty and a migrated database; e2e blocks from the card, unblocks from the panel, reports with a reason and a note |
| 4. A private story log records meaningful events written by the server (first shift, exam result, new friend) | Persistence verified (PGlite and PostgreSQL 16) | Hired, first shift (once), enrolled and new friend in `server/test/social.test.ts`, the exam result in `server/test/university.test.ts`; kept after a reload; written once per key (`socialDatabase.test.ts`) |
| 5. Tests: other players never receive relationship data; blocks enforced on the server; reports stored and owner-scoped | Tested | As above; every repository call checks each owner's (character, account) pair (a mismatched pair is refused even when the other is valid) |

Not yet **verified** by the product owner: the balance (gains, caps,
levels), the card and dialog wording, on Windows and on a phone.

## M10 a place to live: acceptance criteria

Planned below ("M10 — A place to live"); design in GAME_DESIGN.md "A place
to live (M10)"; choices in D-044. Test counts and results: TESTING.md.

| Criterion | Status | Evidence |
| --- | --- | --- |
| 1. Rent a room in the student housing; rent is charged on a game-week schedule through the ledger; rent that can't be paid gives a notice and a mood event, then a move to a cheaper room (Q9), never debt | Persistence verified (PGlite and PostgreSQL 16) | Rules in `shared/test/homes.test.ts`; renting idempotent by request (also two at once), weekly rent once per home and week, the grace period, the move to a cheaper room or out and never below zero in `server/test/housingDatabase.test.ts`; the whole sequence over two game weeks on a hand-moved clock (notice, worry, money arriving in time, the move with the tenant and their furniture, moving out) in `server/test/housing.test.ts`; renting through the door dialog in `e2e/home.spec.ts` |
| 2. Entering and leaving the home works for everyone (others see you leave the square), including after a reload or a drop | Multiplayer functional | `server/test/housing.test.ts` and `e2e/home.spec.ts`: renting takes you in, the other player stops seeing you and sees you again when you come out; a reload brings you back home; the `housing` message is re-sent after a reconnection (`PlazaRoom.onReconnect`) |
| 3. Sleep in a bed restores energy (server-timed; offline rules still hold); comfort comes from furniture | Tested | Sleep through the room in `server/test/housing.test.ts` (energy and comfort up, *Slept well*, standing up afterwards); better beds and seats in `shared/test/homes.test.ts`; waking early keeps what was slept in `e2e/home.spec.ts`; offline rules unchanged (`shared/test/life.test.ts`) |
| 4. Buy furniture from a small catalogue (ledger) and place it in allowed spots, validated by the server and saved | Persistence verified (PGlite and PostgreSQL 16) | Spot rules in `shared/test/homes.test.ts`; purchase once per request, a taken spot, a full storage, two purchases for one spot at once, placing and putting away scoped to the owner in `housingDatabase.test.ts`; through the room (wrong spot, not at home, a repeat answered `duplicate` and charged once) in `housing.test.ts`; the panel, the piece drawn at once and sat on in `e2e/home.spec.ts`; every room type's art checked empty and furnished in `client/test/interiors.test.ts` |
| 5. Tests: area transfer, placement validation, rent idempotency, persistence | Tested | As above; migration 0008 rolls back only while empty, and upgrading an M9-era PostgreSQL database keeps every existing row (TESTING.md) |

Not yet **verified** by the product owner: the rents, prices and grace
period, the room sizes and the furniture's look, on Windows and on a phone.

## M11 NPCs with routines: acceptance criteria

Planned below ("M11 — NPCs with routines"); design in GAME_DESIGN.md
"Locals: non-player characters (M11)"; choices in D-045. Test counts and
results: TESTING.md.

| Criterion | Status | Evidence |
| --- | --- | --- |
| 1. A few NPCs (a barista, students) follow game-time schedules, walk with the same movement rules and reserve seats and spots like players | Tested | Schedules, places and entry points in `shared/test/npcs.test.ts`; through the real room at fast time scales in `server/test/npcs.test.ts`: the barista arrives from her street and works shifts at a staff spot, students go through the hall's door to their lecture desk and at 14:00 to the library, the barista leaves at the end of her day |
| 2. Deterministic decisions (no AI service), cheap enough to measure: server tick time with NPCs is recorded against a budget | Tested | Plans depend only on game time (shared tests); the room times every tick and logs it against `NPC_CONFIG.tickBudgetMs` (5 ms); measured with every NPC active and two players: about 0.5 ms average (TESTING.md) |
| 3. NPCs react to a greeting; players can tell NPCs from players | Tested | A greeted NPC answers with a line (and waves when free), the greeter gets the usual effect, chat is refused (server test); gold tag with the role, "not a player", not counted as a player, *Greet* only (`e2e/npcs.spec.ts`, desktop and Pixel 7 emulation) |
| 4. Tests: schedules at a fast time scale, no two characters on one seat | Tested | Seat holders checked every 50 ms while students fill their desk (server test); seats kept free for players (`npcMayUse`, shared tests); nothing about NPCs is saved (no character row, no wage) |

Not yet **verified** by the product owner: who the locals are, their days
and their lines, on Windows and on a phone.

## M12 part 1 operations: acceptance criteria

The parts of "M12 — Sign-in, deployment and operations" (below) that need
no outside account or hosting decision; choices in D-046. Test counts and
results: TESTING.md.

| Criterion | Status | Evidence |
| --- | --- | --- |
| 1. A guest can delete their whole profile; it removes all its data (from M12 criterion 1) | Tested | Settings → Your data → *Delete my profile…* with the typed word; title screen only, refused while a character is played elsewhere; every window told, the token stops working (`server/test/operations.test.ts`, `e2e/privacy.spec.ts`); the database cascade checked on PGlite and PostgreSQL |
| 2. Basic monitoring: a health check for a host and aggregate status numbers | Tested | `GET /health` (503 when the database doesn't answer) and `GET /status` (players, NPCs, tick time against the budget, memory, CPU, database latency; no names or ids), server test |
| 3. Logs a hosting provider can collect | Tested | `LOG_FORMAT=json`, one JSON object per line (server test) |
| 4. A load test with the room's player limit | Tested | `npm run loadtest`: 16 bot players with the locals on PostgreSQL 16 for 2 minutes (TESTING.md); it found a real problem, fixed: clients at the title screen received deletes for a player map they didn't have |

Not part 1, waiting: sign-in (Q16), hosting with HTTPS/WSS and restored
backups (Q15), and the owner's admin page for reports, which D-042 puts
behind a real account (so it comes with sign-in). Not yet **verified** by
the product owner: the deletion flow on Windows and on a phone.

## Planned milestones (order approved; details proposed)

**The order is approved (D-035); the details below are proposals.** Each
milestone is reviewed with the product owner and refined before it starts.
M7, M7b, M7c, M8, M9, M10 and M11 are built (criteria and evidence in their
acceptance sections above); M12's first part is built (D-046), the rest
waits for Q15 and Q16. Data sketches: DATA_MODEL.md "Proposed"; system design:
GAME_DESIGN.md "Life simulation: proposed next steps". Every milestone also
keeps the standing criteria: server-authoritative changes, owner-scoped
persistence verified on PGlite and PostgreSQL, desktop and phone layouts,
the full existing test suites green, docs updated, laptop test steps in the
report.

### M7 — A first job (café shifts)

Built on 2026-10-26: see "M7 first job: acceptance criteria" above and
GAME_DESIGN.md "Work (M7)".

### M7b — Day and night (approved, D-035)

Built on 2026-10-26: see "M7b day and night: acceptance criteria" above and
D-037.

### M8 — University basics (one fictional course)

Built on 2026-10-27: see "M8 university basics: acceptance criteria" above
and D-040. The plan as it was approved:

Depends on: the game clock (D-021, kept as it is: D-038) and academic
skill (M5); the indoor lecture room (D-038, built in M7c). M7 first so
time and money compete (approved order). The plainer explanation of authored character models (Q6) is given
when M8 starts.

1. Enrol in one fictional course at the university hall (no real course
   names, no implied affiliation).
2. A weekly timetable in game time; a lecture can be attended only in its
   slot and place, checked by the server.
3. Attendance and study build progress; an exam at a scheduled time gives a
   grade computed on the server from attendance, study and academic level.
4. Neglect has visible but gentle consequences (a lower grade, a retake).
5. Timetable, attendance and grades are private, shown in the panel, and
   persistent.
6. Tests include time-based rules at a fast time scale and refusals outside
   the slot.

### M9 — Relationships, public profiles and safety

Built on 2026-10-27: see "M9 relationships and safety: acceptance
criteria" above, D-042 and D-043. The plan as it was approved:

Depends on: the greet interaction (M3) and profiles (M4); the sign-in
method (Q5, answered: Google and email with password, built in M12, D-042),
because blocking and reporting are weak while anyone can make a new guest
profile, so blocks and reports belong to accounts and carry over; and how
reports are reviewed and kept (Q13, answered: by the owner, details kept 90
days, D-042).

1. Tapping another player opens a public panel: name, look, activity and
   your relationship with them; never their needs, money or skills.
2. Relationships grow from shared actions (greetings, a few new social
   actions such as chatting or studying together) and keep a short history;
   private to the two players.
3. Block (they can't target you; their greetings no longer reach you,
   enforced by the server) and report (stored with minimal context, details
   deleted after 90 days; reporting also blocks) from the panel and the menu.
   The owner lists reports with a server command until the admin page
   arrives with sign-in (M12).
4. A private story log records meaningful events written by the server
   (first shift, exam result, new friend).
5. Tests: other players never receive relationship data; blocks enforced on
   the server; reports stored and owner-scoped.

### M10 — A place to live: home, sleep and comfort

**Built** (2026-10-27): see "M10 a place to live: acceptance criteria"
above and D-044.

Depends on: M7 (income for rent); an interiors architecture (Q10: compared in
writing first; entering a door moves the character to another area, and
Colyseus room transfer is not built yet, NETWORKING.md); an inventory design.
Comfort (Q7) and the rent rule (Q9) are approved.

1. Rent a room in the student housing; rent is charged on a game-week
   schedule through the ledger; rent that can't be paid gives a notice and a
   mood event, then a move to a cheaper room (Q9), never debt.
2. Entering and leaving the home works for everyone (others see you leave
   the square), including after a reload or a drop.
3. Sleep in a bed restores energy (server-timed; offline rules still hold);
   comfort comes from furniture.
4. Buy furniture from a small catalogue (ledger) and place it in allowed
   spots, validated by the server and saved.
5. Tests: area transfer, placement validation, rent idempotency, persistence.

### M11 — NPCs with routines

**Built** (2026-10-27): see "M11 NPCs with routines: acceptance criteria"
above and D-045.

Depends on: places with purpose (M7, M8); the server's movement and
interaction systems, used unchanged.

1. A few NPCs (a barista, students) follow game-time schedules, walk with
   the same movement rules and reserve seats and spots like players.
2. Deterministic decisions (no AI service), cheap enough to measure: server
   tick time with NPCs is recorded against a budget.
3. NPCs react to a greeting; players can tell NPCs from players.
4. Tests: schedules at a fast time scale, no two characters on one seat.

### M12 — Sign-in, deployment and operations

**Part 1 built** (2026-10-27): deleting a guest profile, health and
status, JSON logs and a load test; see "M12 part 1 operations: acceptance
criteria" above and D-046. The rest waits for Q15 and Q16.

Depends on: the sign-in method (Q5, answered: D-042), a Google OAuth client
and an email-sending service (owned by the product owner), hosting and
budget decisions. Comes before any test with people outside the project
(D-035).

1. Sign in with Google and with email and password (D-042) upgrades a guest
   profile without losing its characters; account deletion removes all its
   data.
   Before the first public test the owner is also asked again about
   authored character models (Q6; kept procedural for now, D-041).
2. Hosted behind HTTPS/WSS with managed PostgreSQL and backups that have
   been restored at least once.
3. Logs and basic monitoring; a load test with the room's player limit.
4. Moderation of reports (from M9): the owner's admin page, report details
   deleted after 90 days, decisions kept while the account exists (D-042).
   The page needs a signed-in owner account, so it is built with sign-in.

### Technical work that waits for a trigger

| Work | Trigger |
| --- | --- |
| Menus that scroll or page | Before any object offers more than about five actions (likely M7 or M9) |
| Character level of detail and builds spread over frames | Before rooms regularly hold more than about eight players, or if real phones stutter |
| Interest management (send only what is near) | Before more than 16 players should share one square (today the 17th opens a separate copy, measured by the M12 load test) |
| Client-side movement prediction | If players report the movement delay (D-006) |
| Configurable key bindings | Any time; small (a Settings option) |
| Frame-rate measurement on real hardware | As soon as the owner can report it (open items 1 and 3) |

### Dependencies at a glance

| Milestone | Needs first |
| --- | --- |
| M7 job | Done (2026-10-26) |
| M7b day and night | Done (2026-10-26) |
| M7c indoor rooms | Done (2026-10-26) |
| M8 university | Done (2026-10-27) |
| M9 social | Done (2026-10-27) |
| M10 home | M7 income (done); areas and doors (M7c) |
| M11 NPCs | M7 and M8 places |
| M12 operations | Part 1 done (2026-10-27); the rest needs a Google OAuth client and an email-sending service (Q16) and hosting decisions (Q15) |

## Decisions for the product owner

Questions that need the product owner's approval before the work that
depends on them starts. Answered on 2026-10-20 (recorded in D-035) unless
marked **waiting**.

| # | Decision | Answer | What follows |
| --- | --- | --- | --- |
| Q1 | Order of the next milestones | Approved: M7 → M7b → M8 → M9 → M10 → M11; M12 before any public test | "Planned milestones" above |
| Q2 | Arrival view (the shops' wall filled the right of the first view on a computer) | Approved: fade buildings very close to the camera | Implemented 2026-10-20: buildings within 3.5 m of the camera fade, and a faded building lets taps through |
| Q3 | Three lives per guest profile (D-031) | Kept for now | — |
| Q4 | Time scale and offline cap (D-021, D-022) | Answered 2026-10-26: keep the current clock (D-038) | M8 timetables use it |
| Q5 | A real sign-in method and account deletion | Answered 2026-10-27: **B and C**, sign in with Google and with email and password; guests stay and can upgrade without losing characters (D-042) | Built in M12; needs a Google OAuth client and an email-sending service then |
| Q6 | Authored character models (commission or license, or keep procedural; glTF or VRM) | Answered 2026-10-27: **A**, keep the procedural characters for now and improve them in small steps (D-041) | Asked again before the first public test (M12) |
| Q7 | A comfort need | Approved: add it in M10 with furniture of different comfort | M10 |
| Q8 | The daily allowance once jobs exist | Approved: halve it (€15 → €7.50 per game day) in M7 | Done in M7 |
| Q9 | Rent that can't be paid (no debt, D-023) | Approved: a notice and a mood event, then a move to a cheaper room | M10 |
| Q10 | How to build interiors (homes, lecture rooms) | Approved: a written comparison first. 2026-10-26: lectures indoors, and every building gets at least one indoor room, workplaces and homes included (D-038) | Comparison written; option C approved as Q14 and built in M7c (ARCHITECTURE.md "Indoor rooms") |
| Q11 | Later districts: fictional or real streets | Approved: fictional composites until verified references exist | — |
| Q12 | Day and night lighting | Approved: right after M7 | Done in M7b (D-037) |
| Q13 | Who reviews player reports, and how long reports are kept | Answered 2026-10-27: **A, 90 days**, the owner reviews reports on an admin page; report details deleted after 90 days (D-042) | Reports collected in M9; the admin page comes with sign-in in M12 |
| Q14 | How to build indoor rooms, and when | Answered 2026-10-26: option C (areas inside the one server room, doors); each building gets its rooms when it has a use, one room per use (D-039) | Built in M7c |
| Q15 | Hosting for the first deployment (M12): where the game runs, a domain name, and a monthly budget | **Waiting.** Compared on 2026-10-28 in ARCHITECTURE.md "Deployment options for Q15 and Q16": A, one small EU server (about €14 or $15 a month); B, an EU server with managed PostgreSQL (about $22); C, a platform service in Frankfurt (about $13–26). Recommended: C, plus a domain (€10–15 a year) | M12's hosting part |
| Q16 | Accounts the sign-in needs (D-042): a Google OAuth client and an email-sending service, created and owned by the product owner | **Waiting.** Steps and a comparison in the same section; recommended: Resend's free allowance for email. Both need the domain from Q15 first. The keys stay with the owner and on the server, never in the repository | M12's sign-in part |

## Current state (handoff, 2026-10-27, after M12 part 1)

Read this first when starting a new session.

**Code:** `main` in the private GitHub repo `CIR-T34P0T/padova-life-sim`.
M0–M6, M6b (title screen and creation flow), M6c (the first district), M7
(a first job at the café), M7b (day and night), M7c (indoor rooms), M8
(university basics), M9 (relationships and safety), M10 (a place to
live), M11 (NPCs with routines) and the first part of M12 (deleting a guest
profile, health and status, JSON logs, a load test) implemented and
covered by
automated tests (see `docs/TESTING.md` for the
counts and latest results). An integration audit on 2026-10-20 checked every
feature against the code, ran the whole player journey with two clients,
and loaded a real M5-era database with today's server; its matrix
(verified / not verified / partial / missing / blocked) is in TESTING.md
"Integration audit". It found no functional bug; it added regression tests
for gaps (the whole journey with two clients, double-clicked Begin,
gameplay messages from the title screen, the client/server state contract,
the reconnection window ending, a wider appearance boundary), checked that
the production build loads and plays, and removed an unused leftover type.
Characters and their life data are saved in PostgreSQL (embedded PGlite in
development). Characters (D-027) and the district (D-033) are procedural
Stage-1 art generated in code, not artist-made models. No greybox remains.

**What a player can do today:** start from a title screen; create up to
three characters ("lives") per browser in three steps (name and
personality, a look built from starting looks or from scratch with a live 3D
preview, a review), continue the last one, switch between them, edit a look
from the title screen or in the world, delete a life; walk round a
Padua-inspired university square (into the hall's porch, along the portico
behind its columns, between market stalls, gardens and trees; buildings
and trees that hide you fade); sit or sketch on five benches, study at two
desks or at three café tables, buy an espresso/cornetto/panino at the café
kiosk, wash up at the fountain, greet other players; get a job at the café
and work 90-second shifts behind the counter for a wage (€6, or €8 as a
barista from communication level 2; 06:00–23:00 game time, 4 shifts a game
day), and quit it; go into the university hall's lecture room and the
library's reading room to study, meeting only the people in the same room;
enrol in a fictional course at the notice board beside the hall, attend
lectures in the lecture room (on the hour on weekdays) and sit the exam
(Wednesdays and Saturdays) for a grade on the 18–30 scale, retaking it after
a fail; chat with other players, open their card and see your friendship
grow from greetings, chats, studying at the same table and lectures
together; block or report someone (reports are kept 90 days); read your own
story (job, first shift, enrolment, exams, new friends, moving); rent a
private room in the student housing (three sizes, rent every Monday, a
grace period and a move to a cheaper room if it can't be paid), sleep in its
bed, keep comfortable, buy furniture for its spots and make it cosy; meet
four locals (a barista and three students with daily routines, marked as
non-players) and greet them; delete their whole guest profile from Settings; see the square change from dawn to night with everyone
else (lit windows, lamps, stars); watch needs, mood (with reasons), skills,
work, university and money in the character panel; come back later, even
after a server restart, to the same character with the same look, needs,
skills, money, job, course and results, home and furniture, and purchase, wage and rent history.

**Genuinely persistent:** account (guest), its characters (up to three),
each character's profile, appearance config, traits, last position, needs,
skills, mood events, wallet, every money transaction, the job, every
completed shift, the area (room) the character is in, the enrolment and
study count, every completed lecture and every exam result, relationships
and their recent moments, blocks, reports (deleted after 90 days), the
story log, the home (with its rent state and the history of earlier rooms)
and every piece of furniture, placed or stored. **Temporary:**
activity, seats, pending actions (including a meal, a shift, a lecture or an
exam in progress), cooldowns,
online status, the non-player characters (rebuilt from their schedules); the guest identity itself lives only in one browser; looks
saved in the creator and device settings live only in that browser. The world clock is derived from real time, not stored.

**Open items, in priority order:**

| # | Item | Status | Owner |
| --- | --- | --- | --- |
| 1 | Look at the district (by day and at night), the title screen, the creation flow and the characters on the Windows PC (`git pull`, `npm ci`, `npm run dev`) and a phone; say what to change in the art direction (world, light, menus, characters) and whether the frame rate feels smooth | Planned | Product owner |
| 2 | Run the full play loop on Windows (create, café → study, reload) and report | Partly done: the game has run on Windows (after M5); no full report | Product owner |
| 3 | Real-phone test using the manual checklist in `docs/TESTING.md` (steps 1–49) | Planned | Product owner |
| 4 | Play-test the balance (need rates, prices, the €7.50 allowance, study XP, wages, shift length, the daily shift limit, the lecture timetable and exam sittings, the grade targets, relationship gains and daily caps, rents, the grace period, furniture prices, comfort and sleep) and adjust `shared/src/life/config.ts` | Planned | Product owner feedback, then Claude |
| 5 | Decisions for the product owner | Q15 (hosting, domain, budget) and Q16 (Google OAuth client, email service) wait for M12's hosting and sign-in parts | Product owner |

**Recommended next task:** the product owner answers **Q15** (hosting,
domain, budget) and **Q16** (a Google OAuth client and an email-sending
service); then **M12 part 2**: sign-in with a guest upgrade, the admin page
for reports, and hosting with HTTPS/WSS and restored backups (see "Planned
milestones"). Until then, Claude can take the follow-ups below.
Meanwhile the owner tries M9, M10, M11 and the profile deletion. In parallel the product owner looks at the district by day and at night, the title screen,
the creation flow and the characters on Windows and a phone (item 1; the
world lab, `/world-lab.html?time=23:00`, shows every corner at any hour).
Follow-ups not covered by "Technical work that waits for a trigger":
per-object level of detail for the district if real phones need it. (The
title screen now compiles the square's shaders ahead of time; measurements
in TESTING.md.)
