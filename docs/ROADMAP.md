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
| M6 | Characters | Planned | VRM avatars, idle/walk/sit animations, presets and colours; pipeline spike first |
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

## Current state (handoff, 2026-10-18)

Read this first when starting a new session.

**Code:** `main` in the private GitHub repo `CIR-T34P0T/padova-life-sim`.
M0–M5 implemented and covered by automated tests (150 unit/integration
tests, 9 browser tests; see `docs/TESTING.md` for the latest results).
Characters and their life data are saved in PostgreSQL (embedded PGlite in
development). Still placeholders: avatars built from primitives, greybox
world, minimal profile forms, a box for the café counter.

**What a player can do today:** create a character (name, look, up to two
personality traits); walk, sit, sketch on benches, study at desks, buy an
espresso/cornetto/panino at the café, wash up at the fountain, greet other
players; watch needs, mood (with reasons), skills and money in the character
panel; come back later, even after a server restart, to the same character
with the same needs, skills, money and purchase history.

**Genuinely persistent:** account (guest), character profile, appearance,
traits, last position, needs, skills, mood events, wallet and every money
transaction. **Temporary:** activity, seats, pending actions (including a
meal in progress), cooldowns, online status; the guest identity itself lives
only in one browser. The world clock is derived from real time, not stored.

**Open items, in priority order:**

| # | Item | Status | Owner |
| --- | --- | --- | --- |
| 1 | Run the game on the product owner's Windows PC (`git pull`, `npm install`, `npm run dev`), create a character, play the café → study loop, reload | Planned (no report yet since M4) | Product owner |
| 2 | Real-phone test using the manual checklist in `docs/TESTING.md` (steps 1–18) | Planned | Product owner |
| 3 | Confirm `npm run dev` and the embedded database work on Windows; fix if not | Planned (untested on Windows) | Next session, from the owner's report |
| 4 | Play-test the M5 balance (need rates, prices, allowance, study XP) and adjust `shared/src/life/config.ts` | Planned | Product owner feedback, then Claude |
| 5 | Review the time model decisions D-021 (10 game minutes per real minute) and D-022 (offline cap) | Decided in M5 as instructed; owner may change the numbers | Product owner |
| 6 | Decide on a real sign-in method to replace guest accounts, and on account deletion | Open decision (auth model needs approval) | Product owner, with options from Claude |
| 7 | Decide the first real district | Open question, needed before real geometry | Product owner |
| 8 | Decide the order of M6 (characters) and M7 (first job) | Open; Claude recommends M7 first (below) | Product owner |

**Recommended next task:** items 1–4, a real-device play-test of M5 on the
owner's Windows PC and phone. It checks the remaining platform risk (Windows
has never run the game) and gives the first human feedback on the balance.
The next engineering milestone after that, recommended: **M7, a first job**
(a café shift that pays into the M5 ledger and uses a skill), because it
completes the earn → spend loop; M6 (avatars) changes visuals, not gameplay.
