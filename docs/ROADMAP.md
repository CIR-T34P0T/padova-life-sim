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
| M5 | Time and needs | Planned | Server game clock; hunger, energy, social, fun; café and bed as first need sources |
| M6 | Characters | Planned | VRM avatars, idle/walk/sit animations, presets and colours; pipeline spike first |
| M7 | Money and a first job | Planned | Café shift pays a wage; server-side purchases |

After M7: **playable multiplayer prototype**. Later phases: university
schedules and exams, relationships and story log, housing and furnishing, NPC
routines, more districts, moderation tools, deployment.

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

## Current state (handoff, 2026-10-17)

Read this first when starting a new session.

**Code:** `main` in the private GitHub repo `CIR-T34P0T/padova-life-sim`.
M0–M4 implemented and covered by automated tests (94 unit/integration tests,
7 browser tests). Characters are saved in PostgreSQL (embedded PGlite in
development). Still placeholders: avatars built from primitives, greybox
world, minimal profile forms. No needs, skills, money or university systems yet.

**What a player can do today:** create a character (name, look) on first
visit; come back later, even after a server restart, to the same character
at the same spot; change their look; walk, sit on benches, study at desks,
greet other players; get a clear message when something is refused.

**Genuinely persistent:** account (guest), character profile, appearance,
last position. **Temporary:** activity, seats, pending actions, cooldowns,
online status; the guest identity itself lives only in one browser.

**Open items, in priority order:**

| # | Item | Status | Owner |
| --- | --- | --- | --- |
| 1 | Run the game on the product owner's Windows PC (`git pull`, `npm install`, `npm run dev`), including creating a character and reloading | In progress — setup steps provided; no report yet | Product owner |
| 2 | Real-phone test using the manual checklist in `docs/TESTING.md` (now includes saved characters) | Planned | Product owner |
| 3 | Confirm `npm run dev` and the embedded database work on Windows; fix if not | Planned (untested on Windows) | Next session, from the owner's report |
| 4 | Decide on a real sign-in method to replace guest accounts, and on account deletion | Open decision (auth model needs approval) | Product owner, with options from Claude |
| 5 | Decide the shared-world time model (`docs/GAME_DESIGN.md`) | Open question, needed before M5 | Product owner, with a proposal from Claude |
| 6 | Decide the first real district | Open question, needed before real geometry | Product owner |

**Recommended next task:** items 1–3, a real-device check of M0–M4 on the
owner's Windows PC and phone. Windows is the main remaining risk: the embedded
database (PGlite, WebAssembly) and the dev script have only run on Linux.
Then M5 (time and needs), which needs item 5 decided first.

## Next: M5 time and needs (proposed)

Smallest useful version: a server game clock with a day/night cycle; hunger,
energy, social and fun that change over time and through existing actions
(sitting, studying, greeting) plus one new need source (e.g. a café counter);
needs saved in their own table; a compact needs display. Requires the
shared-world time model decision first.
