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
| M7 | A first job | Planned, next (order approved, D-035); design in GAME_DESIGN.md "Work (M7)" | Café shift pays a wage into the M5 ledger; skills start to matter (e.g. pay or eligibility) |
| M7b | Day and night | Planned (approved, D-035) | Light, sky, lamps and windows follow the shared game clock; night stays readable; no gameplay effect |
| M8 | University basics | Planned (order approved; details proposed) | One fictional course: enrolment, a timetable in game time, lectures, an exam with a server-computed grade |
| M9 | Relationships, public profiles and safety | Planned (order approved; details proposed) | Public info panel for other players, relationships grown from shared actions, block and report, a private story log |
| M10 | A place to live | Planned (order approved; details proposed) | A rented room, sleep, comfort, a small furniture catalogue with server-validated placement |
| M11 | NPCs with routines | Planned (order approved; details proposed) | A few deterministic NPCs with game-time schedules using the same interaction points |
| M12 | Sign-in, deployment and operations | Planned; before people outside the project play (D-035) | Real sign-in, account deletion, hosting with backups, HTTPS/WSS, monitoring, a load test |

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
| Skills eventually unlock opportunities | Not started | Levels exist (max 10); nothing is unlocked yet. First use planned for M7 (job) |
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

## Planned milestones (order approved; details proposed)

**The order is approved (D-035); the details below are proposals.** Each
milestone is reviewed with the product owner and refined before it starts;
none has started. Data sketches: DATA_MODEL.md "Proposed"; system design:
GAME_DESIGN.md "Life simulation: proposed next steps". Every milestone also
keeps the standing criteria: server-authoritative changes, owner-scoped
persistence verified on PGlite and PostgreSQL, desktop and phone layouts,
the full existing test suites green, docs updated, laptop test steps in the
report.

### M7 — A first job (café shifts)

Depends on: M5 ledger, skills and interaction hooks; the M6c café kiosk.
Needs a migration (the ledger's `category` CHECK has no `wage`) and
employment tables. Design: GAME_DESIGN.md "Work (M7)".

1. The café counter offers *Ask about work* (hires at once) and, to
   employees, *Work a shift* while the café is open, a staff spot behind the
   counter is free and today's limit isn't reached; unavailable options are
   not shown.
2. A shift is a server-timed action at a standing spot, with progress and
   Cancel like other actions; its effect on needs (energy, fun) is data in
   `shared/src/life/config.ts`.
3. A completed shift pays a wage through `applyMoneyChange` with one key per
   shift: never paid twice, never from a client value, shown as "Wage" in
   the ledger. A cancelled, interrupted or dropped shift pays nothing
   (design default; the owner can switch to proportional pay).
4. Skills matter: working trains communication, and communication level
   changes pay or unlocks the next job grade.
5. Limits: shifts per game day, not while too tired; two players can work at
   once when there are two positions; others see the "working" activity.
6. Employment and wage history survive reload, server restart and network
   drops.
7. The character panel shows the job, grade, shifts today, when the café
   opens and recent wages, with *Quit job*, on desktop and phone.
8. The daily allowance is €7.50 per game day (D-035); earned balances are
   untouched.
9. Tests: unit (pay, limits), integration (shift lifecycle, duplicate
   requests, two players racing for a position), e2e (work a shift, see the
   wage, reload).

### M7b — Day and night (approved, D-035)

Depends on: the shared game clock (D-021) and the district's lighting and
materials (D-033). No server or data change.

1. The sun's direction and colour, the sky, the haze and the ambient light
   follow the replicated game minute through dawn, day, dusk and night, as a
   pure, unit-tested function of the game minute.
2. At night the street lamps, lanterns and some windows light up, and the
   square stays readable: characters, name tags, menus and tap targets are
   as easy to see as by day.
3. Every player sees the same time of day (it comes from the server clock);
   joining at night shows night at once, with no flash of daylight.
4. Both detail levels keep their current draw-call and triangle budgets
   (ASSET_PIPELINE.md); phones get no extra shadow work.
5. No gameplay rule reads the light (needs, money and actions are unchanged).
6. Checked in the world lab at chosen times of day, in the game, and by the
   existing browser tests.

### M8 — University basics (one fictional course)

Depends on: the game clock (D-021) and academic skill (M5); a place for
lectures (Q10: at the hall's entrance without an interior, or an interior,
compared in writing first). M7 first so time and money compete (approved
order). The plainer explanation of authored character models (Q6) is given
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

Depends on: the greet interaction (M3) and profiles (M4); the sign-in
method, decided before M9 (Q5, approved), because blocking and reporting are
weak while anyone can make a new guest profile; and how reports are reviewed
and kept (Q13, raised again before M9).

1. Tapping another player opens a public panel: name, look, activity and
   your relationship with them; never their needs, money or skills.
2. Relationships grow from shared actions (greetings, a few new social
   actions such as chatting or studying together) and keep a short history;
   private to the two players.
3. Block (they can't target you; their greetings no longer reach you,
   enforced by the server) and report (stored with minimal context) from the
   panel and the menu.
4. A private story log records meaningful events written by the server
   (first shift, exam result, new friend).
5. Tests: other players never receive relationship data; blocks enforced on
   the server; reports stored and owner-scoped.

### M10 — A place to live: home, sleep and comfort

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

Depends on: places with purpose (M7, M8); the server's movement and
interaction systems, used unchanged.

1. A few NPCs (a barista, students) follow game-time schedules, walk with
   the same movement rules and reserve seats and spots like players.
2. Deterministic decisions (no AI service), cheap enough to measure: server
   tick time with NPCs is recorded against a budget.
3. NPCs react to a greeting; players can tell NPCs from players.
4. Tests: schedules at a fast time scale, no two characters on one seat.

### M12 — Sign-in, deployment and operations

Depends on: the sign-in method (Q5), hosting and budget decisions. Comes
before any test with people outside the project (D-035).

1. A real sign-in method upgrades a guest profile without losing its
   characters; account deletion removes all its data.
2. Hosted behind HTTPS/WSS with managed PostgreSQL and backups that have
   been restored at least once.
3. Logs and basic monitoring; a load test with the room's player limit.
4. Moderation of reports (from M9) has a working process.

### Technical work that waits for a trigger

| Work | Trigger |
| --- | --- |
| Menus that scroll or page | Before any object offers more than about five actions (likely M7 or M9) |
| Character level of detail and builds spread over frames | Before rooms regularly hold more than about eight players, or if real phones stutter |
| Interest management (send only what is near) | Before a second area (M10) or more than 16 players |
| Client-side movement prediction | If players report the movement delay (D-006) |
| Configurable key bindings | Any time; small (a Settings option) |
| Frame-rate measurement on real hardware | As soon as the owner can report it (open items 1 and 3) |

### Dependencies at a glance

| Milestone | Needs first |
| --- | --- |
| M7 job | M5 ledger and skills, M6c café (done); ledger migration |
| M7b day and night | M5 clock and M6c lighting (done) |
| M8 university | M5 clock and skills (done); Q10 for an indoor lecture room |
| M9 social | M3 greet, M4 profiles (done); the sign-in method (Q5) and the report process (Q13) |
| M10 home | M7 income; the interiors comparison (Q10); area transfer in networking |
| M11 NPCs | M7 and M8 places |
| M12 operations | Q5 and hosting decisions |

## Decisions for the product owner

Questions that need the product owner's approval before the work that
depends on them starts. Answered on 2026-10-20 (recorded in D-035) unless
marked **waiting**.

| # | Decision | Answer | What follows |
| --- | --- | --- | --- |
| Q1 | Order of the next milestones | Approved: M7 → M7b → M8 → M9 → M10 → M11; M12 before any public test | "Planned milestones" above |
| Q2 | Arrival view (the shops' wall filled the right of the first view on a computer) | Approved: fade buildings very close to the camera | Implemented 2026-10-20: buildings within 3.5 m of the camera fade, and a faded building lets taps through |
| Q3 | Three lives per guest profile (D-031) | Kept for now | — |
| Q4 | Time scale and offline cap (D-021, D-022) | **Waiting** (not answered); today's values stay | Matters for M8 timetables, which are set in game time |
| Q5 | A real sign-in method and account deletion | Approved: decide before M9 and before any public test | Options presented before M9 |
| Q6 | Authored character models (commission or license, or keep procedural; glTF or VRM) | **Waiting**: the owner likes the idea and wants a plainer explanation | Explained when M8 starts; procedural characters until then |
| Q7 | A comfort need | Approved: add it in M10 with furniture of different comfort | M10 |
| Q8 | The daily allowance once jobs exist | Approved: halve it (€15 → €7.50 per game day) in M7 | M7 |
| Q9 | Rent that can't be paid (no debt, D-023) | Approved: a notice and a mood event, then a move to a cheaper room | M10 |
| Q10 | How to build interiors (homes, lecture rooms) | Approved: a written comparison first | Before M10, or before M8 if lectures move indoors |
| Q11 | Later districts: fictional or real streets | Approved: fictional composites until verified references exist | — |
| Q12 | Day and night lighting | Approved: right after M7 | M7b |
| Q13 | Who reviews player reports, and how long reports are kept | **Waiting**: to be explained more simply | Raised again before M9 |

## Current state (handoff, 2026-10-20)

Read this first when starting a new session.

**Code:** `main` in the private GitHub repo `CIR-T34P0T/padova-life-sim`.
M0–M6, M6b (title screen and creation flow) and M6c (the first district)
implemented and covered by automated tests (216 unit/integration tests, 19
browser tests; see `docs/TESTING.md` for the latest results).
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
kiosk, wash up at the fountain, greet other players; watch needs, mood (with reasons),
skills and money in the character panel; come back later, even after a
server restart, to the same character with the same look, needs, skills,
money and purchase history.

**Genuinely persistent:** account (guest), its characters (up to three),
each character's profile, appearance config, traits, last position, needs,
skills, mood events, wallet and every money transaction. **Temporary:**
activity, seats, pending actions (including a meal in progress), cooldowns,
online status; the guest identity itself lives only in one browser; looks
saved in the creator and device settings live only in that browser. The world clock is derived from real time, not stored.

**Open items, in priority order:**

| # | Item | Status | Owner |
| --- | --- | --- | --- |
| 1 | Look at the new district, the title screen, the creation flow and the characters on the Windows PC (`git pull`, `npm ci`, `npm run dev`) and a phone; say what to change in the art direction (world, menus, characters) and whether the frame rate feels smooth | Planned | Product owner |
| 2 | Run the full play loop on Windows (create, café → study, reload) and report | Partly done: the game has run on Windows (after M5); no full report | Product owner |
| 3 | Real-phone test using the manual checklist in `docs/TESTING.md` (steps 1–32) | Planned | Product owner |
| 4 | Play-test the M5 balance (need rates, prices, allowance, study XP) and adjust `shared/src/life/config.ts` | Planned | Product owner feedback, then Claude |
| 5 | Remaining decisions in "Decisions for the product owner": Q4 (any time), Q6 (when M8 starts), Q13 (before M9) | Waiting | Product owner, with explanations from Claude |

**Recommended next task:** build **M7, a first job** (design in
GAME_DESIGN.md "Work (M7)", criteria above), which completes the earn →
spend loop; in parallel the product owner looks at the district, the title
screen, the creation flow and the characters on Windows and a phone (item 1;
the world lab, `/world-lab.html`, shows every corner of the district).
Follow-ups not covered by "Technical work that waits for a trigger":
precompile the world's shaders while the title screen is open (entering
takes about 4 s with software rendering, 2.4 s of it the first world frame);
deleting a whole guest profile (with Q5); per-object level of detail for the
district if real phones need it.
