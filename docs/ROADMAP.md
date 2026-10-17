# Roadmap

Each milestone must end with something demonstrably working on desktop and phone.
Statuses: planned · in progress · blocked · implemented · tested · verified.

| # | Milestone | Status | Acceptance (summary) |
| --- | --- | --- | --- |
| M0 | Foundation | Tested | Repo, workspaces, docs, typecheck/test commands, scene loads on desktop and mobile emulation |
| M1 | Walkable world | Tested | Greybox piazza, third-person camera, click/tap-to-move with pathfinding, WASD, joystick, collision |
| M2 | Real multiplayer | Tested | Server-authoritative movement, join/leave, interpolation, reconnection, 2 desktop + 1 mobile-emulated browser |
| M3 | Interaction system | Tested | Select objects and players; contextual menu (desktop radial, mobile sheet); server-validated walk-to-then-act (bench sit/stand, desk study/sit, greet) |
| M4 | Identity and persistence | Planned | Guest accounts, PostgreSQL with migrations, character and position restored after reload |
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

## Current state (handoff, 2026-10-17)

Read this first when starting a new session.

**Code:** `main` in the private GitHub repo `CIR-T34P0T/padova-life-sim`.
M0–M3 implemented and covered by automated tests (51 unit/integration tests,
3 browser tests). No persistence, no real art, no needs/skills/economy yet.

**What a player can do today:** join with a name, walk by click/tap, keyboard
or joystick, see other players, click a bench to sit or stand, click a study
desk to sit or study (an 8-second timed session that has no effect yet), click
another player to greet them, cancel any action, and get an explanation when
something is refused.

**Open items, in priority order:**

| # | Item | Status | Owner |
| --- | --- | --- | --- |
| 1 | Run the game on the product owner's Windows PC (`npm install`, `npm run dev`, two browser windows) | In progress — the first attempt stopped because Git was not installed; setup steps were provided | Product owner, report results |
| 2 | Real-phone test (Android and/or iPhone on the same Wi-Fi), including tapping a bench and greeting, using the manual checklist in `docs/TESTING.md` | Planned | Product owner |
| 3 | Confirm `npm run dev` (scripts/dev.mjs) works on Windows; fix it if not | Planned (untested on Windows) | Next session, from the owner's report |
| 4 | Decide the shared-world time model (`docs/GAME_DESIGN.md`) | Open question, needed before M5 | Product owner, with a proposal from Claude |
| 5 | Decide the first real district | Open question, needed before real geometry | Product owner |

M0–M3 move from **tested** to **verified** once items 1–3 pass and the product
owner signs off.

**Recommended next task:** items 1–3 — a real-device check of everything built
so far (about 30 minutes for the owner), fixing any platform bug found. Then
M4: identity and persistence.

## Next: M4 identity and persistence (proposed)

Smallest useful version: a guest account created on first visit (a random
token stored in the browser), PostgreSQL with versioned migrations, the
character's name, colour and last position saved and restored after a reload
or reconnect, and seats/actions reset cleanly on restore. Needs a decision on
running PostgreSQL locally (Docker) and later hosting; no paid service until
approved.
