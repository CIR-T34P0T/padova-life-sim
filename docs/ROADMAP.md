# Roadmap

Each milestone must end with something demonstrably working on desktop and phone.
Statuses: planned · in progress · blocked · implemented · tested · verified.

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
| M7 | A first job | Planned | Café shift pays a wage into the M5 ledger; skills start to matter (e.g. pay or eligibility) |

After M7: **playable multiplayer prototype**. Later phases: sleep and beds
(with housing), cooking and an inventory, university schedules and exams,
relationships and story log, housing and furnishing, NPC routines, more
districts, moderation tools, deployment.

## M0–M2 walking skeleton: acceptance criteria

| Criterion | Status | Evidence |
| --- | --- | --- |
| `npm install` + one dev command starts client and server | Tested on Linux only | Manual run of `npm run dev`: client served the page, server accepted a matchmaking request. Clean `npm ci` + `npm run check` from the packaged repo passed. Windows pending (open item 3) |
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

## Current state (handoff, 2026-10-19)

Read this first when starting a new session.

**Code:** `main` in the private GitHub repo `CIR-T34P0T/padova-life-sim`.
M0–M6 and M6b (title screen and creation flow) implemented and covered by
automated tests (198 unit/integration tests, 18 browser tests; see
`docs/TESTING.md` for the latest results).
Characters and their life data are saved in PostgreSQL (embedded PGlite in
development). Characters are procedural Stage-1 art (D-027), not
artist-made models. Still placeholders: greybox world, a box for the café counter.

**What a player can do today:** start from a title screen; create up to
three characters ("lives") per browser in three steps (name and
personality, a look built from starting looks or from scratch with a live 3D
preview, a review), continue the last one, switch between them, edit a look
from the title screen or in the world, delete a life; walk, sit, sketch on
benches, study at desks, buy an espresso/cornetto/panino at the café, wash
up at the fountain, greet other players; watch needs, mood (with reasons),
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
| 1 | Look at the title screen, the creation flow and the M6 characters on the Windows PC (`git pull`, `npm ci`, `npm run dev`) and a phone, and say what to change in the art direction (menus and characters) | Planned | Product owner |
| 1b | Confirm D-031 (three lives per guest profile; set `maxCharactersPerAccount` to 1 to go back) | Implemented as asked by the title screen brief; owner may change the number | Product owner |
| 2 | Run the full play loop on Windows (create, café → study, reload) and report | Partly done: the game has run on Windows (after M5); no full report | Product owner |
| 3 | Real-phone test using the manual checklist in `docs/TESTING.md` (steps 1–27) | Planned | Product owner |
| 4 | Play-test the M5 balance (need rates, prices, allowance, study XP) and adjust `shared/src/life/config.ts` | Planned | Product owner feedback, then Claude |
| 5 | Review the time model decisions D-021 (10 game minutes per real minute) and D-022 (offline cap) | Decided in M5 as instructed; owner may change the numbers | Product owner |
| 6 | Decide on a real sign-in method to replace guest accounts, and on account deletion | Open decision (auth model needs approval) | Product owner, with options from Claude |
| 7 | Decide the first real district | Open question, needed before real geometry | Product owner |
| 8 | Decide whether to commission or license authored character models (requirements in ASSET_PIPELINE.md) or keep improving the procedural ones | Open; procedural characters are enough to continue | Product owner |

**Recommended next task:** item 1, the product owner's look at the title
screen, the creation flow and the characters on Windows (and a phone),
because art direction is the owner's call and changes there are cheapest now. The next engineering milestone
after that, recommended: **M7, a first job** (a café shift that pays into
the M5 ledger and uses a skill), which completes the earn → spend loop.
Follow-ups that can wait: spread character builds over frames and add a
lower-detail version for distant players before rooms get busier; precompile
the world's shaders while the title screen is open (entering takes about
4 s with software rendering, 2.4 s of it the first world frame); stop
sending the shared room state to sessions at the title screen (interest
management); deleting a whole guest profile.
