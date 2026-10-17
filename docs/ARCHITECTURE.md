# Architecture

Status as of M4 (walking skeleton, contextual interactions, identity and persistence). Sections marked *planned* describe
intent, not code.

## Overview

```
 Browser (client/)                         Node.js (server/)
 ┌──────────────────────────┐   WebSocket  ┌───────────────────────────┐
 │ input/  gestures → intents├────────────►│ PlazaRoom                  │
 │ net/    Colyseus SDK,     │◄────────────┤  validates intents         │
 │         guest token store │ state patches│  runs shared rules @20 Hz │
 │ render/ Three.js scene    │              │  replicates PlazaState    │
 │ ui/     DOM overlay       │              │ ProfileService ── SQL ──► PostgreSQL
 └────────────┬─────────────┘              └─────────────┬─────────────┘  (or embedded PGlite)
              │ imports                                  │ imports
              └──────────────► shared/ ◄─────────────────┘
                 world layout + interactables · collision · pathfinding · movement
                 interaction rules · profile model + catalogue · message contract + validators · tuning config
```

## Packages

| Package | Responsibility | Must not contain |
| --- | --- | --- |
| `shared/` | Deterministic game rules and the message contract | Rendering, DOM, networking, Node-only APIs |
| `server/` | Rooms, validation, simulation loop, replication, identity, persistence | Rendering; trust in client-reported results or identities |
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
yourself while seated opens the seat's menu (Stand up); standing, it opens
your own menu ("Edit appearance", since M4). Own options are client-side and
never sent as interactions. Menus are built with the shared rules over replicated state and
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

## Identity and persistence (M4)

**Database (`server/src/db`).** One small `Database` interface with two
PostgreSQL backends: a real server through `pg` when `DATABASE_URL` is set,
otherwise embedded PGlite stored in `.data/pglite` (D-015). Numbered SQL
migrations run on server start and through `npm run db:migrate` (D-016).
Schema and rules: `DATA_MODEL.md`.

**Identity (`server/src/identity/guestIdentity.ts`).** Temporary guest
accounts only (D-017). The browser keeps a random secret token
(`client/src/net/identityStore.ts`, `localStorage`) and sends it in the
matchmaking request body. `PlazaRoom.onAuth` resolves it to an account id
before the player joins; an unknown token is refused with error 4401 and the
client starts over with an explanation. No token → anonymous visitor, who may
create a character. Account and character ids from clients are never trusted.

**Profiles (`server/src/profiles`).** `profileRepository.ts` holds all SQL,
every query scoped by the owning account id. `ProfileService.ts` loads with
upgrade/repair (newer versions read-only), creates (guest account + character
in one transaction, rate-limited per IP), updates appearance and saves
position. Validation rules (names, age categories, appearance catalogue,
version upgrades) live in `shared/src/profile.ts`.

**Room lifecycle (`server/src/PlazaRoom.ts`).**
- Anonymous join → `profile {status: "needs_character"}`; nobody is placed in the world.
- `createCharacter` → validated, stored, `identity {guestToken}` sent once, character spawned.
- Join with a valid token → saved character loaded and spawned at its saved
  position (spawn point if that spot is no longer walkable).
- `updateAppearance` → validated against the catalogue, saved, replicated.
- Leave, eviction, room disposal → position saved; autosave every 30 s for
  players who moved.
- Same account in a second session → the newest wins (D-018,
  `profiles/sessionRegistry.ts`); the older one is saved first and closed with
  code 4100. A new session waits for an in-flight save before loading.
- Brief network drop → same session resumes within 20 s; nothing reloads.

**Client.** `main.ts` drives the page: connect with the stored token →
create form or straight into the game. `ui/profilePanel.ts` is a deliberately
MINIMAL form (name, adult-only notice, appearance pickers) and the edit form,
reached by clicking yourself → "Edit appearance". It is not the character
creator (no live preview); that comes later. Avatars (`render/avatars.ts`)
draw every catalogue option with placeholder primitives.

**Services wiring.** `app.ts` builds a `ProfileService` and `SessionRegistry`
per game server and registers them under a key passed in room options
(`services.ts`), so rooms never receive live objects through options.

## Not yet decided or built

- UI framework for larger panels (character info, inventory). Plain DOM was
  enough for M3 menus; see D-007.
- A real sign-in method to replace guest accounts (needs the product owner's decision).
- Hosting, managed PostgreSQL and backups.
- Character pipeline (VRM, M6) — see `ASSET_PIPELINE.md`.
- Shared-world time model — see `GAME_DESIGN.md` open questions.
- Deployment pipeline.
