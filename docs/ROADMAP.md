# Roadmap

Each milestone must end with something demonstrably working on desktop and phone.
Statuses: planned · in progress · blocked · implemented · tested · verified.

| # | Milestone | Status | Acceptance (summary) |
| --- | --- | --- | --- |
| M0 | Foundation | Tested | Repo, workspaces, docs, typecheck/test commands, scene loads on desktop and mobile emulation |
| M1 | Walkable world | Tested | Greybox piazza, third-person camera, click/tap-to-move with pathfinding, WASD, joystick, collision |
| M2 | Real multiplayer | Tested | Server-authoritative movement, join/leave, interpolation, reconnection, 2 desktop + 1 mobile-emulated browser |
| M3 | Interaction system | Planned | Select objects and players; contextual menu (desktop radial, mobile sheet); server-validated walk-to-then-act (sit on bench, greet) |
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

## Current state (handoff, 2026-10-17)

Read this first when starting a new session.

**Code:** two commits on `main` in the private GitHub repo
`CIR-T34P0T/padova-life-sim`. Walking skeleton (M0–M2) implemented and
covered by automated tests. No persistence, no real art, no game systems yet.

**Open items, in priority order:**

| # | Item | Status | Owner |
| --- | --- | --- | --- |
| 1 | Run the game on the product owner's Windows PC (`npm install`, `npm run dev`, two browser windows) | In progress — the first attempt stopped because Git was not installed; setup steps were provided | Product owner, report results |
| 2 | Real-phone test (Android and/or iPhone on the same Wi-Fi), using the manual checklist in `docs/TESTING.md` | Planned | Product owner |
| 3 | Confirm `npm run dev` (scripts/dev.mjs) works on Windows; fix it if not | Planned (untested on Windows) | Next session, from the owner's report |
| 4 | Decide the shared-world time model (`docs/GAME_DESIGN.md`) | Open question, needed before M5 | Product owner, with a proposal from Claude |
| 5 | Decide the first real district | Open question, needed before real geometry | Product owner |

M0–M2 move from **tested** to **verified** once items 1–3 pass and the product
owner signs off.

**Recommended next task:** finish items 1–3 (owner runs it on Windows and a real
phone; fix any platform bug found). Then start M3, the interaction system,
as scoped below. Do not start M3 before the walking skeleton runs on the
owner's machine, so platform bugs are not mixed with new features.

## Next: M3 interaction system (proposed)

Smallest useful version: two interactable object types (bench: sit/stand;
another player: greet), selection highlight, contextual menu on desktop and
mobile, server-validated action queue with walk-to-interaction-point, action
progress and cancel, failure explanations. Introduces React for UI panels (D-007).
