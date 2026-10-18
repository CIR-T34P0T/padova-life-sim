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

## D-004 — PostgreSQL for persistence (2026-10-17, approved; in use since M4)

Relational data (players, relationships, jobs, grades, transactions) fits a
relational database. Introduced at M4 with versioned migrations (D-015, D-016).

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
reconnects automatically. Since M4 a reload or a later visit loads the same
saved character (D-017), at the position saved when the tab closed.

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

## D-015 — PostgreSQL in production, embedded PGlite for development and tests (2026-10-17, M4)

Driver: `pg` (node-postgres, MIT) when `DATABASE_URL` is set. Without it the
server uses PGlite (`@electric-sql/pglite`, Apache-2.0): PostgreSQL compiled
to WebAssembly, running inside the server process and storing data in
`.data/pglite` (or in memory with `PGLITE_DATA_DIR=memory://`). Both run the
same SQL and migrations behind one small interface (`server/src/db/database.ts`).

Why: nobody has to install or run a database server to develop or test,
including on Windows, while production uses a real PostgreSQL as approved in
D-004. Trade-offs: PGlite is single-connection and in-process, fine for one
developer, not for production. Database tests run on both backends when
`TEST_DATABASE_URL` is set (verified against PostgreSQL 16.15). An ORM was not
added; queries are short, parameterised SQL in one repository module.

## D-016 — Own minimal migration runner (2026-10-17, M4)

Numbered SQL files in `server/migrations` (`0001_name.sql`) with
`-- migrate:up` and `-- migrate:down` sections, applied in order, each in its
own transaction together with its `schema_migrations` row, serialised with a
PostgreSQL advisory lock. Commands: `npm run db:migrate | db:rollback | db:status`;
the server also migrates on start unless `DB_MIGRATE_ON_START=false`.
About 110 lines with no extra dependency. Limitation: statements are split on
line-ending semicolons, so a migration needing semicolons inside a string or
function body must go in its own file. Revisit if migrations grow complex.

## D-017 — Temporary guest identity only (2026-10-17, M4)

There is no sign-in yet. On first visit the server creates a **guest account**
and gives the browser a random 256-bit secret ("guest token", prefix `plsg1_`),
shown once. The server stores only its SHA-256 hash. The browser keeps the token
in `localStorage` and sends it in the matchmaking request body (never a URL);
the server resolves it to an account in `onAuth` before the player joins. A
client-supplied account or character id is never accepted as proof of anything.

This is a stand-in, not an account system, and the UI says so. Limitations:
whoever holds the token controls the character; clearing site data or using
another device or browser starts over; no recovery; a script running on the
page (XSS) could read the token; no account deletion yet. New guest accounts
are limited per IP address per hour (default 10, `GUEST_CREATIONS_PER_IP_PER_HOUR`),
in memory per server process. A real sign-in method needs the product owner's
decision (auth model, D-004 scope) before it is built.

## D-018 — One live session per account: the newest wins (2026-10-17, M4)

Opening the game in a second tab, window or device with the same guest token
moves the character there. The older session's position is saved, the
character is removed, and that connection is closed with code 4100; its page
explains "Playing in another window" with a "Play here instead" button. A
session waiting in its reconnection window is also cancelled, so it cannot come
back as a duplicate. A new session waits for the old session's final save
before loading, so it never loads an older position. Single process only: a
shared registry (Colyseus presence/Redis) is needed before running several
server processes.

## D-019 — Player characters are adults (2026-10-17, M4)

The profile stores an age category (`child`, `teen`, `adult`) so the data
model distinguishes adults from non-adults (needed later for NPCs and for
rules such as romance being adult-only). Player-created characters must be
`adult`; the server refuses anything else (`age_category_not_allowed`), and
the create form states that all player characters are university-age adults.
Product owner can revisit; changing it is a rules change in
`shared/src/profile.ts` (`PLAYER_AGE_CATEGORIES`), not a migration.

## D-020 — One character per account, for now (2026-10-17, M4)

Enforced by a unique index on `characters.account_id`. Several characters per
account later means dropping that index and adding a character picker; the
tables already separate account and character.

## D-021 — One server-kept world clock derived from real time (2026-10-18, M5)

Game time = 08:00 on Day 1 at 2026-10-01T00:00Z, advancing at 10 game minutes
per real minute (`GAME_TIME_SCALE`, default 10; one game day = 2 h 24 min).
Calculated from the server's real clock, so it needs no storage, survives
restarts and is identical in every room. The server replicates the current
game minute; clients only display it. Needs change per game hour on the
server's fixed-rate loop. Action durations stay in real seconds (they are
about what the player watches), with fixed effects per completed action.
Trade-offs: changing the scale moves the clock (fine in development, needs a
migration plan in a live world); a shared clock means no pausing, so needs are
tuned gently. Product owner can change the scale and rates; they are configuration.

## D-022 — Offline progression is capped and protective (2026-10-18, M5)

On entering the world, time since the last save is applied once, capped at
8 game hours: hunger, hygiene, social and fun fall at half rate and not below
35; energy recovers at the resting rate up to 90. Skills and money never change
offline; no allowance back pay. Chosen so absence never creates a crisis,
while the world still visibly moves on.

## D-023 — Money is an append-only ledger in whole cents, no debt (2026-10-18, M5)

`character_wallets.balance_cents` (database CHECK ≥ 0) plus
`wallet_transactions` (income/expense, amount, balance after, category, item,
game minute, request key). Every change runs in one database transaction that
locks the wallet row, checks the balance, writes the ledger row and updates
the balance. `UNIQUE (character_id, request_key)` makes repeated requests
harmless: the same purchase, allowance or refund is never applied twice.
Prices come only from the server's catalogue. No debt mechanic exists.

## D-024 — Life data is private to its owner (2026-10-18, M5)

Needs, mood, skills, traits and money are sent only to the character's owner
(`life` message), never through the shared room state. Others still see the
public activity (sitting, studying, eating…). Keeps traffic low and avoids
exposing personal stats; showing selected stats to friends can come with
relationships.

## D-025 — Food is consumed on purchase; refunds cover abandoned payments (2026-10-18, M5)

There is no inventory yet, so buying at the café pays (database transaction
on arrival at the counter) and then eats or drinks at the counter, with
effects applied gradually. If the player cancels or leaves while the payment
is still being processed, a refund transaction is recorded. An inventory
(carry food, eat later) can replace this without changing the ledger.

## D-026 — Standing interaction points reuse the seat machinery (2026-10-18, M5)

The café counter and fountain have reservable *standing* points. They use the
existing seat reservation (`Seat.pose = "stand"`) rather than a second system:
reserved while walking and acting, released when the action ends, never left
"occupied" like a seat. The field is still called `seats` in code and data to
avoid churn; ARCHITECTURE.md explains the naming.
