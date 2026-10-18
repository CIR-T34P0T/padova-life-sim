# Padova Life SIM

A browser-based 3D multiplayer life simulation set in a stylised Padua, Italy.
Inspired by the depth of life-simulation games; original code, art and design.

> Fan-made project. Not affiliated with, or endorsed by, the University of Padua.

## Current status: walking skeleton, interactions, saved characters, life simulation (M0–M5)

What exists today is a deliberately plain, end-to-end slice that proves the
architecture. It is **not** the game yet.

| Feature | Status |
| --- | --- |
| Greybox piazza (placeholder boxes) | Locally functional |
| Third-person camera (drag to orbit, wheel/pinch to zoom) | Locally functional |
| Click/tap-to-move with server pathfinding | Multiplayer functional, tested |
| Keyboard (WASD/arrows) and on-screen joystick movement | Multiplayer functional, tested |
| Server-authoritative movement and validation | Multiplayer functional, tested |
| Join / leave / brief-disconnect reconnection | Multiplayer functional, tested |
| Click/tap objects and players for contextual actions (desktop radial menu, mobile bottom sheet) | Multiplayer functional, tested |
| Bench: sit / sketch / stand · Study desk: sit / study · Café counter: buy food · Fountain: wash up · Other player: greet | Multiplayer functional, tested |
| Action progress, cancel, and explanations when refused | Multiplayer functional, tested |
| Saved character profile (name, adult age category, appearance, position) in PostgreSQL | Persistence verified (tested on embedded PGlite and PostgreSQL 16) |
| Temporary guest identity (one browser = one character; no sign-in) | Multiplayer functional, tested; temporary by design (D-017) |
| Minimal create-character and edit-appearance forms | Locally functional, tested; not the full character creator |
| Needs (hunger, energy, hygiene, social, fun), mood with reasons, five skills, personality traits | Multiplayer functional, persistence verified (tested on PGlite and PostgreSQL 16) |
| Money: balance, server-validated purchases and allowances, transaction history, no debt | Multiplayer functional, persistence verified |
| Shared world clock (10 game minutes per real minute) and capped offline progression | Multiplayer functional, tested |
| Character panel (your needs, mood, skills, money, current action) and top-right time/money chip | Locally functional, tested (desktop and phone emulation) |
| Placeholder avatars built from primitives (body, head, eyes, three hair shapes, colours) | Placeholder |
| Full character creator, sleep/beds, cooking, inventory, jobs, university courses | Not started (see docs/ROADMAP.md) |

"Tested" means covered by the automated tests in `docs/TESTING.md`. Mobile is
tested in Chromium mobile emulation only; a real phone has not been tested yet.
All automated runs so far were on Linux; running on Windows is not yet confirmed.
Open items and the next task are listed in `docs/ROADMAP.md` ("Current state").

## Prerequisites

- Node.js 22 or newer (`node -v`)
- npm 10 or newer (comes with Node)
- Git (`git --version`). On Windows: `winget install --id Git.Git -e --source winget`, then open a new terminal.

No database server or Docker is needed for development: the game server
uses an embedded PostgreSQL (PGlite) and stores data in `.data/pglite`.
A real PostgreSQL server is optional (see "Your saved data").

## Getting started

The repository is private: <https://github.com/CIR-T34P0T/padova-life-sim>

```bash
git clone https://github.com/CIR-T34P0T/padova-life-sim.git
cd padova-life-sim
npm install
npm run dev
```

### Windows notes

- Use a normal (not Administrator) PowerShell or Command Prompt, and clone into
  your user folder (for example `cd $HOME\Documents`), not `C:\Windows\system32`.
- If PowerShell says "running scripts is disabled", use Command Prompt, or run
  `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once.
- When Windows Firewall asks about Node.js, allow it on private networks
  (needed for phones on the same Wi-Fi).
- If `npm run dev` fails, start the two parts in separate terminals:
  `npm run dev -w server` and `npm run dev -w client`, and report the error
  (the combined script has not been tested on Windows yet).

Then open <http://localhost:5173>, create a character, and play. To see two
players, open a **private/InPrivate window** or another browser: tabs in the
same browser share one guest identity, so a second tab takes over the first
character instead of adding a player.

The client runs on port 5173 and the game server on port 2567.

### How to play

- **Walk:** click/tap the ground, or use WASD/arrow keys (desktop) or the joystick (touch).
- **Interact:** click/tap a bench, a study desk (in front of the university hall,
  north-west), the café counter (east of where you arrive), the fountain or
  another player, then pick an action from the menu.
- **Your character:** click/tap yourself → **Character**, or the time/money
  chip at the top right. The panel shows your needs, mood (and why), skills,
  money with recent purchases, and what you're doing.
- **Look after yourself:** buy an espresso, cornetto or panino at the café
  (hunger, energy), wash up at the fountain (hygiene), greet people (social),
  sketch on a bench (fun, creativity), study at a desk (academic skill; not
  when you're exhausted). Needs drop slowly over time and nothing bad happens
  quickly: low needs make your mood worse, which slows learning.
- **Money:** you start with €100 and get €15 each game day you play. You can't
  spend more than you have.
- **Stand up:** click/tap yourself while seated, or just walk away.
- **Cancel:** the Cancel button on the action bar, or Escape.
- **Camera:** drag to turn; mouse wheel or pinch to zoom.
- **Change your look:** click/tap yourself (while standing) → **Edit appearance**.

### Your saved data

- Your character (name, look, personality, last position, needs, skills,
  mood events, money and transactions) is saved on the **server**, in
  `.data/pglite` by default. It survives page reloads and server restarts.
  While you're away, needs change slowly for at most 8 game hours.
- Your **browser** keeps only a temporary guest key. Clearing the site's data,
  using another browser or device, or deleting `.data/` starts over. There is
  no sign-in, recovery or account deletion yet (docs/DECISIONS.md D-017).
- To reset the development database: stop the server and delete the `.data`
  folder.
- To use a real PostgreSQL server instead, set `DATABASE_URL`, for example
  `postgresql://user:password@localhost:5432/padova`. Migrations run when the
  server starts, or manually with `npm run db:migrate`.

### Playing from a phone on the same Wi-Fi

1. Run `npm run dev` on your computer.
2. Find your computer's local IP address (Windows: `ipconfig`, look for "IPv4 Address").
3. On the phone, open `http://<that-ip>:5173`.
4. If it can't connect, allow Node.js through the computer's firewall for private networks.

Landscape gives the best view; portrait works.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts server and client together (Ctrl+C stops both) |
| `npm run typecheck` | Type-checks all three packages |
| `npm test` | Unit and server integration tests (Vitest) |
| `npm run check` | Typecheck + tests |
| `npm run test:e2e` | Browser tests with three simultaneous players (Playwright) |
| `npm run build` | Production build of the client into `client/dist` |
| `npm start` | Runs the game server without file watching |
| `npm run db:migrate` | Applies pending database migrations |
| `npm run db:status` | Lists applied and pending migrations |
| `npm run db:rollback` | Reverts the latest migration (`-- 2` for two). **Deletes the data in the tables it drops** |

First-time Playwright setup: `npx playwright install chromium`.

## Configuration

| Variable | Where | Default | Purpose |
| --- | --- | --- | --- |
| `PORT` | server | `2567` | WebSocket server port |
| `LOG_LEVEL` | server | `info` | `debug`, `info`, `warn`, `error`, `silent` |
| `CLIENT_PORT` | client | `5173` | Vite dev server port |
| `VITE_SERVER_URL` | client | `ws://<page host>:2567` | Game server address |
| `DATABASE_URL` | server | unset | Real PostgreSQL connection URL. Unset = embedded PGlite. Keep it secret; it never reaches the browser |
| `PGLITE_DATA_DIR` | server | `.data/pglite` | Where embedded PGlite stores data; `memory://` = nothing saved |
| `DB_MIGRATE_ON_START` | server | `true` | Set `false` to apply migrations only with `npm run db:migrate` |
| `GUEST_CREATIONS_PER_IP_PER_HOUR` | server | `10` | New guest characters allowed per IP address per hour (abuse limit) |
| `GAME_TIME_SCALE` | server | `10` | Game minutes per real minute (1–1440). Changing it moves the world clock; for development and testing (D-021) |
| `CHROMIUM_PATH` | e2e | Playwright's browser | Use an existing Chromium for tests |
| `TEST_DATABASE_URL` | tests | unset | Also run database tests on a real PostgreSQL (creates and drops throwaway databases) |
| `E2E_DATABASE_URL` | e2e | unset | Run the browser tests' server on a real PostgreSQL instead of in-memory |

See `.env.example`. The only secret is `DATABASE_URL`, when used.

## Repository layout

```
shared/   Game rules used by both sides: world layout, collision, pathfinding, message validation,
          life/ (clock, needs, mood, skills, traits, economy and all their tuning)
server/   Authoritative Colyseus game server; db/ (database + migrations runner),
          identity/ (guest tokens), profiles/ (character profiles),
          life/ (needs, skills, money, clock), migrations/ (SQL)
client/   Three.js browser client (rendering, input, networking)
e2e/      Playwright multi-browser tests
docs/     Design, architecture, roadmap, decisions, testing
```

## Documentation

- [Game design](docs/GAME_DESIGN.md)
- [Architecture](docs/ARCHITECTURE.md) and [decisions](docs/DECISIONS.md)
- [Networking](docs/NETWORKING.md) and [data model](docs/DATA_MODEL.md)
- [Roadmap](docs/ROADMAP.md)
- [Testing](docs/TESTING.md)
- [Asset pipeline](docs/ASSET_PIPELINE.md)
- [Engineering conventions for AI assistants](CLAUDE.md)
