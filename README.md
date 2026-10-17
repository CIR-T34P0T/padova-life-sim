# Padova Life SIM

A browser-based 3D multiplayer life simulation set in a stylised Padua, Italy.
Inspired by the depth of life-simulation games; original code, art and design.

> Fan-made project. Not affiliated with, or endorsed by, the University of Padua.

## Current status: walking skeleton + interactions (M0–M3)

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
| Bench: sit / stand · Study desk: sit / study · Other player: greet | Multiplayer functional, tested (studying has no effect yet) |
| Action progress, cancel, and explanations when refused | Multiplayer functional, tested |
| Placeholder capsule avatars with name tags | Placeholder |
| Character creation, needs, skills, jobs, university, persistence | Not started (see docs/ROADMAP.md) |

"Tested" means covered by the automated tests in `docs/TESTING.md`. Mobile is
tested in Chromium mobile emulation only; a real phone has not been tested yet.
All automated runs so far were on Linux; running on Windows is not yet confirmed.
Open items and the next task are listed in `docs/ROADMAP.md` ("Current state").

## Prerequisites

- Node.js 22 or newer (`node -v`)
- npm 10 or newer (comes with Node)
- Git (`git --version`). On Windows: `winget install --id Git.Git -e --source winget`, then open a new terminal.

No database or Docker is needed yet.

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

Then open <http://localhost:5173>. Open a second browser window (or a private
window) to see two players.

The client runs on port 5173 and the game server on port 2567.

### How to play

- **Walk:** click/tap the ground, or use WASD/arrow keys (desktop) or the joystick (touch).
- **Interact:** click/tap a bench, a study desk (in front of the university hall,
  north-west) or another player, then pick an action from the menu.
- **Stand up:** click/tap yourself while seated, or just walk away.
- **Cancel:** the Cancel button on the action bar, or Escape.
- **Camera:** drag to turn; mouse wheel or pinch to zoom.

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

First-time Playwright setup: `npx playwright install chromium`.

## Configuration

| Variable | Where | Default | Purpose |
| --- | --- | --- | --- |
| `PORT` | server | `2567` | WebSocket server port |
| `LOG_LEVEL` | server | `info` | `debug`, `info`, `warn`, `error`, `silent` |
| `CLIENT_PORT` | client | `5173` | Vite dev server port |
| `VITE_SERVER_URL` | client | `ws://<page host>:2567` | Game server address |
| `CHROMIUM_PATH` | e2e | Playwright's browser | Use an existing Chromium for tests |

See `.env.example`. No secrets are needed at this stage.

## Repository layout

```
shared/   Game rules used by both sides: world layout, collision, pathfinding, message validation
server/   Authoritative Colyseus game server
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
