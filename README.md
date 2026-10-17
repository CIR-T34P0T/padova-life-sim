# Padova Life SIM

A browser-based 3D multiplayer life simulation set in a stylised Padua, Italy.
Inspired by the depth of life-simulation games; original code, art and design.

> Fan-made project. Not affiliated with, or endorsed by, the University of Padua.

## Current status: walking skeleton (M0–M2)

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
| Placeholder capsule avatars with name tags | Placeholder |
| Character creation, needs, jobs, university, persistence | Not started (see docs/ROADMAP.md) |

"Tested" means covered by the automated tests in `docs/TESTING.md`. Mobile is
verified in Chromium mobile emulation only; a real phone has not been tested yet.

## Prerequisites

- Node.js 22 or newer (`node -v`)
- npm 10 or newer (comes with Node)

No database or Docker is needed yet.

## Getting started

```bash
npm install
npm run dev
```

Then open <http://localhost:5173>. Open a second browser window (or a private
window) to see two players.

The client runs on port 5173 and the game server on port 2567.

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
