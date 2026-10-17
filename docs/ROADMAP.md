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
| `npm install` + one dev command starts client and server | Tested | `npm run dev` (scripts/dev.mjs); e2e starts both |
| Two desktop browsers and one phone see each other move smoothly | Tested (phone = emulation) | e2e test; real phone pending (manual checklist in TESTING.md) |
| Server rejects illegal moves (teleport, walls) | Tested | Integration tests: forged positions ignored, blocked targets rejected, speed capped |
| Closing a tab removes the player for everyone | Tested | e2e final step |
| Brief connection loss reconnects to the same character | Tested | Integration test with simulated drop |
| Automated two-browser test passes | Tested | e2e (3 browsers) |

Not yet **verified**: needs a run on a real phone and the product owner's sign-off.

## Next: M3 interaction system (proposed)

Smallest useful version: two interactable object types (bench: sit/stand;
another player: greet), selection highlight, contextual menu on desktop and
mobile, server-validated action queue with walk-to-interaction-point, action
progress and cancel, failure explanations. Introduces React for UI panels (D-007).
