# CLAUDE.md — Padova Life SIM engineering conventions

Permanent instructions for AI assistants (and humans) working in this repo.
The full product brief lives in the claude.ai Project; this file is the
in-repo summary that must stay true to the code.

## Product in one paragraph

A persistent, browser-based 3D multiplayer life simulation set in a stylised
Padua. Players create anime-inspired characters, study, work, socialise and
build their own stories. The world provides possibilities; players create the
stories. Desktop (mouse + keyboard) and mobile (touch) are both first-class.
The Sims is a gameplay reference only: never copy its assets, UI or content.
Never imply affiliation with the University of Padua.

## Stack (approved, see docs/DECISIONS.md)

- TypeScript everywhere, npm workspaces: `shared/`, `server/`, `client/`.
- Client: Three.js (WebGL2), Vite, DOM/CSS overlay for UI. No React yet
  (D-007); it may be added for data-heavy panels without new approval, never
  for the game loop.
- Server: Node.js 22 + Colyseus 0.18 (`@colyseus/core`, `@colyseus/ws-transport`).
- Database: PostgreSQL via `pg` in production (`DATABASE_URL`); embedded
  PGlite for development and tests (D-015). Own SQL migration runner (D-016).
- Identity: temporary guest tokens only (D-017). Do not present them as accounts.
  Approved for M12, not built: sign in with Google and with email and
  password, a guest upgrading without losing characters (D-042).
- Tests: Vitest (unit + server integration), Playwright (multi-browser e2e).

Do not change the renderer, networking framework, database, package manager
or auth model without the product owner's approval.

## Architecture rules

- **Server is authoritative.** Clients send intents ("walk to X"), never
  results ("I am at X"). Positions, money, inventory, grades, jobs and
  relationships are decided by the server.
- **Rules live in `shared/`** as pure, deterministic, unit-tested functions
  with no rendering or networking code. The server runs them; the client may
  use them for display and early feedback only.
- **Validate every message** on the server with the parsers in
  `shared/src/protocol.ts`. Unknown message types are ignored.
- **Ownership comes from the session.** Profile reads/writes are scoped by the
  account id resolved in `onAuth`; never accept an account or character id from
  a client as proof of ownership. All SQL lives in repository modules:
  `server/src/profiles/profileRepository.ts`, `server/src/life/lifeRepository.ts`,
  `server/src/social/socialRepository.ts` and
  `server/src/housing/housingRepository.ts`.
- **Money is a ledger.** Every change goes through `applyMoneyChange`
  (row-locked, idempotent by request key, never below zero). Prices come from
  the server's catalogue, never from a client. No debt unless a design
  decision adds it.
- **Life data is private.** Needs, mood, skills, traits, money, the job and
  the course with its grades go only to their owner (`life` message), and the
  home with its rent and furniture only to its tenant (`housing`), never
  into the shared Colyseus state. A relationship goes only to its two
  players; blocks and the story log only to their owner; reports never to
  players (M9).
- **Safety (M9, D-042, D-043).** Blocks and reports belong to accounts (the
  server resolves them from sessions); a block stops every player action
  both ways with the same neutral reason, checked first. Reports keep
  minimal context and are deleted after 90 days (`SAFETY_CONFIG`). Social
  rules live in `shared/src/life/relationships.ts`; shared moments come only
  from actions the server saw.
- **Game time comes from the server clock** (`shared/src/life/clock.ts`,
  replicated as `gameMinute`); clients never run their own game timers.
  Day and night are drawn from it on the client
  (`client/src/render/world/daylight.ts`, D-037) and are presentation only:
  no gameplay rule reads the light.
- **Schema changes are migrations** (`server/migrations/NNNN_name.sql` with up
  and down). Profile data shape changes bump `PROFILE_VERSION` with an upgrade step.
- **Replicate only what others need to see.** Internal state (paths, rate
  counters) stays in server-only structures, not in the Colyseus schema.
- **Tuning values go in `shared/src/config.ts`** (life simulation:
  `shared/src/life/config.ts`), not inline. Life rules are pure functions in
  `shared/src/life/`.
- **Interactions follow one lifecycle** (`server/src/InteractionSystem.ts`):
  validate → reserve → walk to the interaction point → execute on arrival →
  complete. New object types add data to `shared/src/world.ts` and rules to
  `shared/src/interactions.ts`; they don't add special cases to the room.
  Gameplay effects (needs, skills, money) plug in through `InteractionHooks`,
  implemented by `server/src/life/LifeSystem.ts`, and are defined as data in
  `shared/src/life/config.ts` (`ACTION_EFFECTS`, `CAFE_MENU`, `JOBS`,
  `COURSES`). Wages are paid only for completed shifts, through the same
  ledger (`recordShift`, one payment per shift id). Lectures and exams count
  only when completed and recorded (`recordLecture`, `recordExam`, one per
  timetable key); grades are computed on the server from stored rows
  (`examGrade` in `shared/src/life/university.ts`, D-040). Timetables are in
  game time; Day 1 is a Monday.
- **Appearance is cosmetic and never about ethnicity** (D-029). The
  appearance config (`shared/src/appearance/`) has no ethnicity, race or
  heritage field, presets are named by look, and no gameplay rule reads
  appearance (a test in `server/test/boundaries.test.ts` guards this).
  New options are catalogue data plus renderer code in
  `client/src/render/avatar/`; every option must change the drawn character
  (or be reported as covered by `visibleLayers`).
- **The world is collision first** (D-033). `shared/src/world.ts` decides
  what blocks movement; the art in `client/src/render/world/` is drawn
  inside those boxes. Below head height (2.2 m) nothing solid may be drawn
  outside its obstacle, and every obstacle must be visibly filled;
  `client/test/world.test.ts` checks both. A new prop is an obstacle (stable
  id, kind, label) plus a builder; a new clickable object reuses an
  interactable kind. Look at changes in `client/world-lab.html`.
- **Homes are private areas** (M10, D-044): one `home/<id>` area per
  tenancy, built by `homeArea` (`shared/src/homes.ts`) from the room type
  and the furniture in its fixed spots; the server adds it while its tenant
  is in the world and only the tenant can enter (the housing door's
  `HOME_LINK` resolves to their own home). Home seats stay out of the
  replicated seat map (`server/src/seats.ts`). Rent is weekly through the
  ledger, never debt; unpaid rent moves you to a cheaper room after a grace
  period (`shared/src/life/housing.ts`). New furniture is catalogue data
  (`FURNITURE`) plus a builder in `client/src/render/world/props.ts`;
  `client/test/interiors.test.ts` checks every room type furnished. Look at
  homes with `world-lab.html?area=home&room=<type>&furnished=1`.
- **Indoor rooms are areas** (D-039): a room is a layout in
  `shared/src/interiors.ts`, listed in `shared/src/areas.ts`, with a pair of
  linked doors; ids stay unique across areas. The server keeps each
  character in one area (movement, collision, interactions per area) and
  sends each client only its area's players (`StateView`). A building gets a
  room when it has a use, one room per use. Check rooms with
  `world-lab.html?area=<id>`.
- **The title screen is the lobby** (D-031). Joining lists the account's
  characters (up to `PROFILE_CONFIG.maxCharactersPerAccount`); a character
  enters the world only through `enterWorld` (an id the server checks against
  the session's account) or `createCharacter`. Client screens live in
  `client/src/ui/screens/`, driven by `client/src/ui/flow.ts`; nothing is
  saved before the player confirms on a review step.
- **Menus follow D-032**: palette tokens at the top of `styles.css`, Spritz
  orange only for the one main action of a screen, at least 44 px touch
  targets, and no option or setting without a working effect.
- **Input is device-agnostic.** `client/src/input` turns mouse/touch/keyboard
  into gestures; gameplay code never checks the device type.
- Placeholders must be labelled as placeholders in code and docs.

## Starting a new session

1. `git status` and `git pull` (repo: `CIR-T34P0T/padova-life-sim`, branch `main`).
2. Read `docs/ROADMAP.md` → "Current state" (open items, the next task) and
   "Decisions for the product owner" (don't build what depends on one still
   marked waiting).
3. Read `docs/TESTING.md` → known issues, and how to run tests in Claude's cloud
   workspace (Playwright needs `CHROMIUM_PATH` there). Don't edit files under
   `client/` or `shared/` while browser tests run: Vite reloads the page.
4. Run `npm install` and `npm run check` to confirm a green baseline before editing.

## Workflow

1. Read the relevant docs and code before changing anything.
2. Keep changes small and focused; reuse existing modules.
3. Run `npm run check` (typecheck + tests). For gameplay or networking
   changes also run `npm run test:e2e`.
4. Update docs in the same change when behaviour changes. One source of
   truth per topic, so extend the home below instead of starting a new file:
   - setup, commands, feature status → README;
   - gameplay rules, the creation screen flow, desktop and mobile
     interaction requirements, proposed life-sim extensions → GAME_DESIGN;
   - modules, the action → server → saved-state path → ARCHITECTURE;
   - the character profile schema, tables, proposed tables → DATA_MODEL;
   - messages, replication, who owns which state → NETWORKING;
   - avatar format and loading, world art direction, asset standards and
     licences → ASSET_PIPELINE;
   - milestones, acceptance criteria, dependencies, questions for the
     product owner → ROADMAP; approved decisions and the owner's answers →
     DECISIONS; test results → TESTING.
   Mark anything designed but not built as **Proposed**, and never describe
   a proposal, a placeholder or an untested path as done.
5. Report honestly: what was tested, the actual results, known limitations.
6. End every report to the product owner with step-by-step instructions for
   testing the change on their Windows laptop (PowerShell commands, what to
   click, what they should see, and what to send back if it fails).

Status vocabulary for features: planned, partially implemented, locally
functional, multiplayer functional, persistence verified, production ready.

## Commit conventions

Focused commits with a clear subject line. Don't commit secrets, `.env`, or
build output. Don't discard unrelated changes in the working tree.
