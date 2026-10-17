# Architecture

Status as of M3 (walking skeleton + contextual interactions). Sections marked *planned* describe
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
                 world layout + interactables · collision · pathfinding · movement
                 interaction rules · message contract + validators · tuning config
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
device-neutral events: `onTap`, `onHover` (mouse only), `onCancel` (Escape),
`onRotate`, `onZoom`, `onMoveInput`.

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

## Interactions (M3)

Click/tap-to-interact, inspired by life-sim games, with original UI.

**Data (`shared/src/world.ts`).** Each clickable object is an `Interactable`
with a stable id equal to its obstacle id (`bench-1`, `desk-2`), a kind, a
menu label, and `seats`. A seat has a stable id (`bench-1/seat-a`), the
seated position and facing, and an `approach` point on walkable ground where
the character stands before sitting and returns to when standing up.

**Rules (`shared/src/interactions.ts`).** Pure functions:
`objectActions` / `playerActions` decide menu contents;
`validateObjectAction` / `validatePlayerAction` are the server checks
(action offered by this target, straight-line distance ≤ 35 m, free seat,
not yourself, target connected, 5 s greeting cooldown per pair);
`chooseSeat` and `greetApproachPoint` pick interaction points.

**Server (`server/src/InteractionSystem.ts`).** One pending action per
player. A request is validated, then any previous action is cancelled
("replaced"), a seat is reserved in replicated `state.seats`, a path to the
interaction point is planned (unreachable → rejected, nothing reserved), and
the character walks there. Every tick the system checks arrival: within
0.25 m of the point it executes (snaps to the seat, sets `activity`);
stuck short of it → `failed: blocked`. Studying and greeting run on server
timers. Movement orders interrupt actions and stand a seated player up;
a drop cancels the pending action but keeps an occupied seat for the
reconnection window; leaving frees all seats. The room (`PlazaRoom`) only
routes messages and runs movement, then `interactions.tick()`.

**Client (`client/src/interaction/interactionController.ts`).** Raycasts
taps against the ground, obstacles and avatar bodies (`pick`). Results:
object, other player, self, ground, or a non-interactive obstacle. Tapping
yourself while seated opens the seat's menu (Stand up); standing, it selects
nothing. Menus are built with the shared rules over replicated state and
re-rendered only when their contents change. With a menu open, tapping
elsewhere only dismisses it.

**Presentation (`client/src/ui`).** `actionMenu.ts` has two implementations
of one interface: a radial fan of options anchored above the target
(fine pointer) and a bottom sheet with 56 px buttons (coarse pointer; docked
right in landscape, full width in portrait with the joystick hidden while
open). Override with `?menu=radial|sheet`. `actionProgress.ts` shows the
current action with a progress bar for timed actions and a Cancel button.
Highlights (`render/worldScene.ts` outline, `render/avatars.ts` rings),
the seated pose, activity label and "Ciao!" bubble are presentation only.

## Multiplayer

See `NETWORKING.md`. In short: Colyseus room per area, server-authoritative
movement, delta-encoded state patches every 50 ms, client-side snapshot
interpolation 100 ms in the past, automatic reconnection within 20 s.

## Persistence and identity

None yet. Players are anonymous; display names are not reserved. A reload or
closed tab creates a new character. *Planned (M4):* guest accounts, PostgreSQL,
saved character and position.

## Not yet decided or built

- UI framework for larger panels (character info, inventory). Plain DOM was
  enough for M3 menus; see D-007.
- Authentication provider, database schema and migration tool (M4).
- Character pipeline (VRM, M6) — see `ASSET_PIPELINE.md`.
- Shared-world time model — see `GAME_DESIGN.md` open questions.
- Hosting and deployment.
