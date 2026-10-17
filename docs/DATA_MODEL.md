# Data model

## Current (walking skeleton) — in memory only

Nothing is persisted. All data lives in the room and disappears when players leave.

**Replicated (`server/src/schema.ts`):**

```
PlazaState
  players: Map<sessionId, PlayerState>
  seats:   Map<seatId, sessionId>   occupied or reserved seats

PlayerState
  name: string         sanitised display name (2–20 chars) or "Guest N"
  x, z: float32        metres, server-decided
  rotation: float32    radians around Y, 0 faces +Z
  moving: boolean
  connected: boolean   false during the reconnection window
  hue: uint16          placeholder body colour, derived from session id
  activity: string     "idle" | "sitting" | "studying" | "greeting"
  seatId: string       seat occupied while sitting/studying, else ""
  targetId: string     player being greeted while greeting, else ""
```

**Server-only (`PlayerRuntime`, `server/src/runtime.ts`):** current movement
intent (path waypoints or direction), rate-limit counters, the pending action
(id, action, target, reserved seat, phase, goal point, timer, re-plan count)
and last greeting time per target.

**Static content (`shared/src/world.ts`):** world bounds, obstacle boxes with
kind and placeholder label, spawn points, and interactables (id = obstacle id,
kind `bench` | `desk`, label, seats with seated position/facing and approach point).

## Planned (M4 onward, not implemented)

Entities expected first: `account` (guest or registered), `character`
(appearance, name), `character_state` (last position, needs), later
`enrolment`, `job`, `transaction`, `relationship`, `story_event`, `housing`.

Rules to keep:
- Every persistent value has a single server-side owner and is changed only by
  validated server actions.
- Currency changes are recorded as transactions, never as a client-set balance.
- Store the minimum personal data; plan deletion and moderation workflows.
- Migrations are versioned and reversible where practical; back up before
  destructive migrations.
