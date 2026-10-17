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
- Client: Three.js (WebGL2), Vite, DOM/CSS overlay for UI. No React yet;
  React for UI panels is planned from M3 and needs no new approval.
- Server: Node.js 22 + Colyseus 0.18 (`@colyseus/core`, `@colyseus/ws-transport`).
- Database: PostgreSQL planned for M4. Not installed yet.
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
- **Replicate only what others need to see.** Internal state (paths, rate
  counters) stays in server-only structures, not in the Colyseus schema.
- **Tuning values go in `shared/src/config.ts`**, not inline.
- **Input is device-agnostic.** `client/src/input` turns mouse/touch/keyboard
  into gestures; gameplay code never checks the device type.
- Placeholders must be labelled as placeholders in code and docs.

## Starting a new session

1. `git status` and `git pull` (repo: `CIR-T34P0T/padova-life-sim`, branch `main`).
2. Read `docs/ROADMAP.md` → "Current state": open items and the next task.
3. Read `docs/TESTING.md` → known issues, and how to run tests in Claude's cloud
   workspace (Playwright needs `CHROMIUM_PATH` there).
4. Run `npm install` and `npm run check` to confirm a green baseline before editing.

## Workflow

1. Read the relevant docs and code before changing anything.
2. Keep changes small and focused; reuse existing modules.
3. Run `npm run check` (typecheck + tests). For gameplay or networking
   changes also run `npm run test:e2e`.
4. Update docs in the same change when behaviour changes. One source of
   truth per topic: README (setup/status), docs/* (design and decisions).
5. Report honestly: what was tested, the actual results, known limitations.

Status vocabulary for features: planned, partially implemented, locally
functional, multiplayer functional, persistence verified, production ready.

## Commit conventions

Focused commits with a clear subject line. Don't commit secrets, `.env`, or
build output. Don't discard unrelated changes in the working tree.
