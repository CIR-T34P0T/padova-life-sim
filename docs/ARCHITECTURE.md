# Architecture

Status as of the walking skeleton (M0–M2). Sections marked *planned* describe
intent, not code.

## Overview

```
 Browser (client/)                         Node.js (server/)
 ┌──────────────────────────┐   WebSocket  ┌───────────────────────────┐
 │ input/  gestures → intents├────────────►│ PlazaRoom                  │
 │ net/    Colyseus SDK      │◄────────────┤  validates intents         │
 │ render/ Three.js scene    │ state patches│  runs shared rules @20 Hz │
 │ ui/     DOM overlay       │              │  replicates PlazaState    │
 └────────────┬─────────────┘              └─────────────┬─────────────┘
              │ imports                                  │ imports
              └──────────────► shared/ ◄─────────────────┘
                 world layout · collision · pathfinding · movement
                 message contract + validators · tuning config
```

## Packages

| Package | Responsibility | Must not contain |
| --- | --- | --- |
| `shared/` | Deterministic game rules and the message contract | Rendering, DOM, networking, Node-only APIs |
| `server/` | Rooms, validation, simulation loop, replication | Rendering; trust in client-reported results |
| `client/` | Rendering, input, UI, interpolation, network glue | Authoritative decisions |

`shared/` is consumed as TypeScript source (no build step): Vite bundles it for
the client, `tsx` runs it on the server.

## Frontend and rendering

- Three.js r186 with `WebGLRenderer` (WebGL2). WebGPU is a later option.
- `render/worldScene.ts` builds the scene **from the shared world layout**, so
  visuals and collision cannot drift apart.
- `render/quality.ts` picks a profile: phones (coarse pointer) get pixel ratio
  ≤ 1.5, no shadows, no antialiasing. Override with `?quality=high|low`.
- Name tags use `CSS2DRenderer` (DOM elements positioned over the canvas).
- Portrait screens get a wider vertical field of view (`render/cameraRig.ts`).

## Input

`client/src/input/inputController.ts` is the single input layer. It emits
device-neutral events: `onTap`, `onRotate`, `onZoom`, `onMoveInput`.

- Tap vs drag: ≤ 8 px movement and < 450 ms is a tap; anything else rotates
  the camera. Two pointers pinch-zoom and never produce a tap.
- Keyboard movement and the virtual joystick both produce camera-relative
  input; `game.ts` converts it to a world direction for the server.
- `touch-action: none`, no page zoom, no text selection during play.

## Movement and collision

- World: a 48 × 48 m greybox piazza of axis-aligned boxes (`shared/src/world.ts`).
- Characters are circles (radius 0.35 m) colliding with boxes; movement slides
  along walls and is sub-stepped so it cannot tunnel (`collision.ts`).
- Click/tap-to-move uses grid A* (0.5 m cells, 8-directional, no corner
  cutting) with line-of-sight smoothing (`navigation.ts`). See D-005.
- The server steps every character at 20 Hz (`movement.ts`).

## Multiplayer

See `NETWORKING.md`. In short: Colyseus room per area, server-authoritative
movement, delta-encoded state patches every 50 ms, client-side snapshot
interpolation 100 ms in the past, automatic reconnection within 20 s.

## Persistence and identity

None yet. Players are anonymous; display names are not reserved. A reload or
closed tab creates a new character. *Planned (M4):* guest accounts, PostgreSQL,
saved character and position.

## Not yet decided or built

- UI framework for panels (React planned at M3).
- Authentication provider, database schema and migration tool (M4).
- Character pipeline (VRM, M6) — see `ASSET_PIPELINE.md`.
- Shared-world time model — see `GAME_DESIGN.md` open questions.
- Hosting and deployment.
