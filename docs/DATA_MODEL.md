# Data model

## Current (walking skeleton) — in memory only

Nothing is persisted. All data lives in the room and disappears when players leave.

**Replicated (`server/src/schema.ts`):**

```
PlazaState
  players: Map<sessionId, PlayerState>

PlayerState
  name: string         sanitised display name (2–20 chars) or "Guest N"
  x, z: float32        metres, server-decided
  rotation: float32    radians around Y, 0 faces +Z
  moving: boolean
  connected: boolean   false during the reconnection window
  hue: uint16          placeholder body colour, derived from session id
```

**Server-only (`PlazaRoom.runtimes`):** current movement intent (path
waypoints or direction) and rate-limit counters per player.

**Static content (`shared/src/world.ts`):** world bounds, obstacle boxes with
kind and placeholder label, spawn points.

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
