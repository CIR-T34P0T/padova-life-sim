# Decisions

Significant technical decisions, newest last. Changing one needs the product
owner's approval and a new entry explaining why.

## D-001 — TypeScript across client, server and shared rules (2026-10-17, approved)

One language lets game rules be written once in `shared/` and executed by the
server (authority) and client (display, early feedback).

## D-002 — Three.js for rendering (2026-10-17, approved)

Chosen over Babylon.js mainly for the anime-character pipeline: `three-vrm` is
the reference loader for VRM avatars. Three.js is a renderer rather than a full
engine, so pathfinding, input and UI are our own modules. Target WebGL2 for
mobile reach; WebGPU later.

## D-003 — Colyseus 0.18 for authoritative multiplayer (2026-10-17, approved)

Provides rooms, schema-based delta state sync, matchmaking and reconnection.
We depend on `@colyseus/core` + `@colyseus/ws-transport` rather than the
all-in-one `colyseus` package to avoid unused auth/monitor/Redis modules.
MIT licence.

## D-004 — PostgreSQL for persistence (2026-10-17, approved, not yet installed)

Relational data (players, relationships, jobs, grades, transactions) fits a
relational database. Introduced at M4 with versioned migrations.

## D-005 — Grid A* pathfinding for the first area (2026-10-17)

A uniform 0.5 m grid over one 48 m piazza is ~9,200 cells, cheap to search and
fully testable. Recast/navmesh is deferred until interiors, stairs or larger
districts need it. `NavGrid.findPath` is the contract to keep when replacing it.

## D-006 — Movement intents, not positions (2026-10-17)

Clients send `moveTo` (target point) or `moveDir` (unit direction). The server
pathfinds, clamps speed and resolves collision. Forged positions are
impossible by construction. Trade-off: the local player sees its own movement
with ~100–150 ms delay (no client prediction yet). Prediction with
reconciliation is a planned improvement once interactions exist.

## D-007 — No React yet (2026-10-17, revised for M3)

The skeleton's UI was a join form and two status pills. M3's radial menu,
action sheet and progress pill were also built in plain DOM/TypeScript
(about 300 lines) without trouble, so React was still not added. Revisit when
data-heavy panels arrive (character info, inventory, relationships). If
added, React renders UI panels only, never the game loop.

## D-008 — Closing the tab leaves immediately; network drops get 20 s (2026-10-17)

`pagehide` sends a consented leave so a closed tab disappears for everyone at
once. Unexpected disconnects hold the character for 20 s while the SDK
reconnects automatically. Consequence: reloading the page creates a new
character until persistence (M4) exists.

## D-009 — Source control on a private GitHub repo, trunk on `main` (2026-10-17)

Code lives at `CIR-T34P0T/padova-life-sim` (private). Small, tested changes go
straight to `main`; risky or multi-step features use a branch and are merged
once `npm run check` and the e2e suite pass. Check the working tree and pull
before changing anything.

## D-010 — Tooling versions (2026-10-17)

TypeScript 7 (native compiler), Vite 8, Vitest 5, Playwright 1.64, tsx 4,
Three.js r186, Colyseus 0.18. Vitest 4 could not be installed: npm 10 failed
while resolving its optional peer dependencies. Vitest 5 installs cleanly.
Upgrade majors deliberately and record the change here.

## D-011 — One action at a time; a new request replaces the current one (2026-10-17)

Each player has at most one pending action (walking to it or doing it). A new
valid request cancels the old one with reason `replaced`; an invalid request
leaves the current action untouched. A multi-step action queue (as in
life-sim games) can be added later on top of the same lifecycle.

## D-012 — Seats are reserved when an action is accepted, and replicated (2026-10-17)

The seat is claimed when the request is accepted, not on arrival, so two
players can never walk to the same seat. Reservations live in replicated
`state.seats` so every client's menu shows only free seats. Released on
cancel, failure, standing up, or leaving.

## D-013 — Menu presentation follows the pointer type (2026-10-17)

Fine pointer (mouse) → radial menu anchored to the target; coarse pointer
(touch) → bottom sheet. This is a presentation choice made in `ui/`;
gameplay code never checks the device. `?menu=radial|sheet` forces either.

## D-014 — Per-room tuning overrides for tests (2026-10-17)

`createGameServer(tuning)` passes overrides (walking speed, timers, distance
limit, world layout) to the room. Production passes none and uses the shared
config. This keeps integration tests fast and lets them use purpose-built
worlds (e.g. an unreachable bench) without test-only branches in game code.
