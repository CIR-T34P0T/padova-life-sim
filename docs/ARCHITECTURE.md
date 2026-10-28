# Architecture

Status as of M6c (walking skeleton, contextual interactions, identity and
persistence, life simulation, procedural characters, the title screen and
creation flow, and the first district). Everything here describes code that
exists, except sections and bullets marked **Proposed** or listed under "Not
yet decided or built".

## Overview

```
 Browser (client/)                         Node.js (server/)
 ┌──────────────────────────┐   WebSocket  ┌───────────────────────────┐
 │ input/  gestures → intents├────────────►│ PlazaRoom                  │
 │ net/    Colyseus SDK,     │◄────────────┤  validates intents         │
 │         guest token store │ state patches│  runs shared rules @20 Hz │
 │ render/ Three.js scene    │              │  replicates PlazaState    │
 │ ui/     DOM overlay       │              │  LifeSystem (needs, money)│
 │                           │              │ ProfileService ┐          │
 │                           │              │ LifeService ───┴─ SQL ──► PostgreSQL
 └────────────┬─────────────┘              └─────────────┬─────────────┘  (or embedded PGlite)
              │ imports                                  │ imports
              └──────────────► shared/ ◄─────────────────┘
                 world layout + interactables · collision · pathfinding · movement
                 interaction rules · profile model · message contract + validators · tuning config
                 life/: clock · needs · mood · skills · traits · economy · action effects
                 appearance/: catalogue · versioned config + validation · skin colour · presets · randomiser · visibility
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
  visuals and collision cannot drift apart (D-033):
  - the detailed art comes from `render/world/` (kit, buildings, props,
    ground, backdrop, signs), drawn inside the obstacle boxes and merged into
    about 47 meshes;
  - every obstacle also gets an **invisible box** (`blockers`) that taps and
    menu anchors use; chairs carry their table's id (`partOf`), the
    portico's upper floors have an extra tap box, and the ground beyond the
    edge answers taps with "Beyond the piazza (not open yet)";
  - `pickTargets()` is what a tap can hit: ground and boxes, minus faded
    buildings and their overhangs, so a see-through building lets taps
    through to what is visible behind it (D-035);
  - `update(camera, you, dt, gameMinute)` runs each frame: buildings and
    tree canopies that hide your character fade to 16 % opacity, and so do
    buildings the camera is inside or within 3.5 m of (D-035), the sky dome follows the camera, and the hall's
    clock hands show the shared game time;
  - **day and night (M7b, D-037):** when the replicated game minute changes,
    `update` asks `render/world/daylight.ts` (a pure function of the minute)
    for the light and applies it to the sun or moon light, the hemisphere
    fill, the haze, the page background, the sky dome's colours, the cloud
    tint, two night-only meshes (stars and moon; lamplight pools on the
    ground) and the shared uniforms of `render/nightShading.ts`. Those
    uniforms drive two small toon-shader additions: world materials add a
    warm glow where the geometry's `glow` attribute marks lit windows and
    lanterns, and character materials add a fraction of their own colour as
    light at night. The light is applied in the same frame update that runs
    before the first render after entering, so a player joining at night
    never sees a frame of daylight; the clock comes only from the server
    (D-021), so everyone sees the same time of day. The character preview
    (creator, portraits) resets the character lift before it draws. No
    shared rule or server module reads the light (guarded by
    `server/test/boundaries.test.ts`);
  - the district is built just after the title screen appears
    (`{ defer: true }`); `ready` / `isReady()` let entering the world wait for it;
  - once it is built and the browser is idle, `Game.warmUpShaders` compiles
    the square's shaders and the characters' (from two stand-in characters,
    one patterned and one shown as away, added for the compile and removed)
    with `renderer.compileAsync`, or `compile` where the parallel-compile
    extension is missing; nothing is drawn. Character materials are shared
    and never disposed, so their programs stay. Skipped if the player has
    already entered. The debug hook reports it (`warmUp`) and the last entry
    (`entry`: time to the first frame showing your character, its slowest
    frame, shader programs compiled meanwhile). Indoor rooms and shadow maps
    still compile on first use.
- `client/world-lab.html` shows the district without a server (developer page), at any time of day with `?time=HH:MM`.
- `render/quality.ts` picks a profile: phones (coarse pointer) get pixel ratio
  ≤ 1.5, no shadows, no antialiasing. The Graphics setting (title screen →
  Settings) or `?quality=high|low` overrides it; read once at page load.
- Name tags use `CSS2DRenderer` (DOM elements positioned over the canvas).
- Portrait screens get a wider vertical field of view (`render/cameraRig.ts`).
- The world renders only while the player is in it (`Game.enterWorld` /
  `leaveWorld`) and not while a full-screen panel such as the creator covers
  it (`Game.setCovered`), so menus and the creator's preview have the GPU to
  themselves. Avatars of other players are built only once this client
  enters the world.

## Characters (M6, D-027 to D-030)

`client/src/render/avatar/` builds every character procedurally from its
appearance config; there are no character model files yet (ASSET_PIPELINE.md).

| Module | Role |
| --- | --- |
| `metrics.ts` | Sliders and presets → joint heights, widths and radii (one source for body, clothes, hair and poses) |
| `geometry.ts` | Tubes, sweeps, ellipsoids, merging; every piece has position, normal, uv and colour attributes |
| `head.ts` | Head deformed by face shape and sliders; eyes, brows, nose, lips, ears, freckles, beauty marks; blush and stubble in the skin colours |
| `hair.ts` | Hair styles and beards as geometry built from the head surface (shells with a tapered hairline, hanging locks that clear the face and body, curls, buns) |
| `body.ts` | Torso, arms, legs, clothing colours and shells (sleeves, skirts, jackets, hoods, trousers, shoes), standing and seated variants |
| `accessories.ts` | Glasses and headwear |
| `materials.ts`, `patterns.ts` | Shared soft cel-shading materials; garment patterns drawn into small canvas textures, cached per pattern and colour |
| `character.ts` | `CharacterModel`: parts on pivots (head, torso, two arms, two thighs, two shins), incremental rebuild, poses |
| `avatar.ts` | In-world wrapper: name tag, bubble, rings, invisible picking capsule |

Each moving part is **one merged, vertex-coloured mesh** (plus a pattern
mesh when a garment is patterned and seated-only skirt pieces), so a
character is 8–12 draw calls and every character shares the same materials.
`setAppearance` compares per-part signatures and rebuilds only the parts
whose inputs changed (hair → head only; a top → torso and arms). Poses
(idle, walk, seated, studying, sketching, greeting, café and fountain
actions) only rotate pivots. Strand placement is seeded, so all clients
draw identical hair. `render/previewStage.ts` is the lit turntable shared
by the creator and the character lab (`client/lab.html`, a developer page
that renders presets and option sweeps with their build cost).

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

- World: a 48 × 48 m square of axis-aligned boxes (`shared/src/world.ts`, 74
  obstacles: buildings split around the porch, portico columns, street
  planters, furniture, trees, lamps). The art is drawn inside them (D-033, D-034).
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
the character stands before sitting and returns to when standing up. A seat
tagged `use: "staff"` (the two spots behind the café counter, M7) is used
only for working a shift; every other action uses the untagged points
(`seatsFor`).

**Rules (`shared/src/interactions.ts`).** Pure functions:
`objectActions` / `playerActions` decide menu contents;
`validateObjectAction` / `validatePlayerAction` are the server checks
(action offered by this target, straight-line distance ≤ 60 m, free seat,
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
yourself while seated opens the seat's menu (e.g. Sketch, Stand up, plus
"Character"); standing, it opens your own menu ("Character", "Edit look"). Own options are client-side and
never sent as interactions. Menus are built with the shared rules over replicated state and
re-rendered only when their contents change. With a menu open, tapping
elsewhere only dismisses it.

**Presentation (`client/src/ui`).** `actionMenu.ts` has two implementations
of one interface: a radial fan of options anchored above the target
(fine pointer; it widens for long labels and becomes a column above the
target when the fan would overlap) and a bottom sheet with 56 px buttons (coarse pointer; docked
right in landscape, full width in portrait with the joystick hidden while
open). Override with `?menu=radial|sheet`. `actionProgress.ts` shows the
current action with a progress bar for timed actions and a Cancel button.
Highlights (a warm glow on the object's own mesh in `render/worldScene.ts`,
rings in `render/avatar/avatar.ts`), the seated pose, activity label and
"Ciao!" bubble are presentation only.

## Life simulation (M5)

Rules and meanings: `GAME_DESIGN.md` "Time model" and "Life simulation";
decisions D-021 to D-026.

**Rules (`shared/src/life`).** Pure, unit-tested functions, no I/O:
`clock.ts` (game minute from real time, day and hh:mm), `needs.ts` (decay
per game hour by activity and traits, gains, offline catch-up), `mood.ts`
(score from needs plus recent mood events, with reasons), `skills.ts` (XP
curve, levels, trait and mood multipliers), `traits.ts` (validation),
`economy.ts` (menu lookup, euro formatting, affordability), `effects.ts`
(what each timed action or café item does, and how much of it applies after
a fraction of its duration), `work.ts` (M7: grade from skill levels,
opening hours, shifts today, why a shift can't start) and `university.ts`
(M8: the weekly timetable in absolute game minutes, why a lecture or the
exam can't start, the exam grade). `clock.ts` also gives every game day a
weekday (Day 1 is a Monday). All tuning is in `life/config.ts`, including
the job catalogue `JOBS` and the course catalogue `COURSES`.

**World clock (D-021).** One clock per server, derived from real time:
`gameMinuteAt(Date.now(), timeScale, offset)`, default 10 game minutes per
real minute (`GAME_TIME_SCALE`); `GAME_CLOCK_OFFSET_MINUTES` shifts it for
development and tests (default 0). The room replicates `state.gameMinute`; clients
never run their own clock, so frame rate cannot change game time.

**Server (`server/src/life`).**
- `lifeRepository.ts`: all life SQL, scoped by the owning account like the
  profile SQL; money changes are row-locked, idempotent ledger transactions.
- `LifeService.ts`: load (with the capped offline catch-up, D-022), save
  together with the position in one transaction, purchase/refund with
  server-side prices, daily allowance; hire, quit and pay a shift (M7);
  enrol, record a lecture or a study session, grade an exam (M8).
- `LifeSystem.ts`: in-memory life of every character in the room. Each tick
  (after movement, before interactions complete) it steps needs, adds fitness
  XP for distance actually walked, applies the running action's effect in
  proportion to elapsed time, expires mood events, grants the daily
  allowance on a new game day, and sends the owner a throttled `life`
  message. It also implements the interaction hooks below.

**Interaction hooks.** `InteractionSystem` stays generic and calls an
`InteractionHooks` object (implemented by `LifeSystem`): `checkStart` (e.g.
too tired; can't afford; the café is closed), `effectFor`, `purchase` and
`refund` (async, on arrival at the counter), `onCompleted`, `onGreeting`,
for work (M7) `jobOf`, `hire`, `startShift` and `payShift`, and for the
university (M8) `courseOf`, `enrol`, `startCourseAction` and
`finishCourseAction`. A pending action has phases: `approach` (walking) →
`paying` (waiting for the database: a purchase being charged, the player
shows "ordering"; a hire or an enrolment being written) → `active` (timed
effect); a finished shift, lecture or exam goes back to `paying` while it is
recorded and only then completes. If a purchase
is cancelled or replaced while paying, the completed payment is refunded
(D-025). Standing spots (café counter, fountain) reuse the seat mechanism
with `pose: "stand"` (D-026).

**Work (M7).** Rules and numbers: `GAME_DESIGN.md` "Work (M7)". *Ask about
work* (`ask_work`) is untimed: on arrival at a customer spot the `hire` hook
writes the job (`hireCharacter`) and the action completes once it is stored.
*Work a shift* (`work`) walks to a free staff spot; on arrival `startShift`
re-checks the limits with the shared rule (`shiftRefusal`) and fixes the
shift's id, grade and wage in the pending action; the shift then runs as a
timed effect like studying. When its time is up `payShift` records the shift
and pays the wage in one transaction (`recordShift`, key `wage:<shift id>`);
the action completes only if that succeeds, and the completion effect
(communication XP, *Good day's work*) applies then. A shift that ends early
is never recorded or paid. `quitJob` (a client message) cancels any shift
first, then deletes the job. Job changes are applied in memory only after
the database confirms, and a per-character busy flag stops two job changes
or a shift start overlapping.

**University (M8).** Rules and numbers: `GAME_DESIGN.md` "University
(M8)". *Enrol* (`enrol`) at the square's notice board is untimed like *Ask
about work*: on arrival the `enrol` hook writes the enrolment
(`enrolCharacter`) and the action completes once it is stored. *Attend the
lecture* (`attend`) and *Sit the exam* (`exam`) are seated timed actions at
desks tagged `lecture` (the lecture room's): `checkStart` refuses them
outside the timetable with the shared rules (`lectureRefusal`,
`examRefusal`); on reaching the desk `startCourseAction` checks again (late
entry may have closed during the walk) and fixes which lecture or sitting
the action counts for (its timetable key) in the pending action. When the
time is up `finishCourseAction` records the lecture (`recordLecture`, one
row per lecture key) or grades the exam (`recordExam`: grade computed in the
database transaction from stored attendance and study and the academic
level, one per sitting key); the action completes only if that succeeds.
The life update with the new count or result is sent before the
completion, so the client's note reads the new values. A completed study
session while enrolled also counts (`recordStudySession`, written straight
away). Course changes are applied in memory only after the database
confirms.

**Client.** `ui/characterPanel.ts` shows the player's own needs, mood (with
reasons), skills, work (job, grade, wage, shifts today, opening hours and
*Quit job*; M7), university (course, timetable, next lecture, attendance
and study bars, exam sittings, the grade sitting now would give, the last
result; M8), money with recent transactions, and current action, from
the server's `life` message only; nothing is calculated as truth on the
client. Desktop: a 300 px column on the right; touch: a bottom sheet under
half the screen in portrait, docked right in landscape. Opened by clicking
yourself → "Character" or the top-right chip (`ui/hud.ts`: weekday and
time, money, mood colour). Café options show prices and are greyed out when the player
can't afford them; focus actions show "Too tired"; *Work a shift* shows wage
and length, or is greyed out with the reason it can't start (D-036); the
lecture and the exam likewise, with the next one's time in game and real
time (`ui/university.ts`, M8). The server re-checks
everything. Traits (up to two, optional) are picked on the name and
personality step (`ui/screens/setupScreen.ts`; the M4–M6 `ui/profilePanel.ts`
was replaced by the title screen flow in M6b).

## Relationships, safety and the story log (M9)

Rules and numbers: `GAME_DESIGN.md` "Relationships (M9)", "Safety (M9)" and
"Story log (M9)"; choices in D-042 and D-043.

**Rules (`shared/`).** `life/relationships.ts`: the level of a score, a
moment's effect under the daily cap, the fixed order of a pair, the story
and relationship view types. `interactions.ts`: *Chat* is a player action
like *Greet*, with its own cooldown (`validatePlayerAction` looks the
cooldown up per action). `protocol.ts`: `parseTarget`, `parseUnblock`,
`parseReport`. Tuning: `RELATIONSHIP_CONFIG`, `ACTION_EFFECTS.chat`,
`CHAT_EFFECTS` (`life/config.ts`), `SAFETY_CONFIG` (`config.ts`).

**Server (`server/src/social`).**
- `socialRepository.ts`: all SQL for relationships and their moments,
  blocks, reports (with their limits and the 90-day deletion) and story
  events; every call checks each owner's (character, account) pair.
- `SocialSystem.ts`: keeps the blocks of the accounts in the world in
  memory, so the interaction system can ask synchronously whether one
  player may target another (`refusal`, a block either way → the neutral
  `not_reachable`). It records shared moments (`shared`), tells both
  players, and on reaching Friend writes both stories and gives both a mood
  event; it answers player cards, blocks, unblocks and reports, sends each
  owner their `safety` and `story`, and deletes old reports (on start and
  hourly, set up by the room).
- `InteractionSystem` calls the social hooks: the block check comes first
  for any player action (before cooldowns, so a blocked player always gets
  the same answer); a greeting counts when it starts; a chat is a timed
  effect for the starter (the life system applies it like studying),
  completed only if the two stay within 4 m, then `onChatted` gives the
  other player their share and the moment counts; when a study session or
  a lecture completes, anyone still studying at the same table or attending
  the same lecture shares the moment (counted once, by whoever finishes
  first). `cancelBetween` stops a greeting or chat when a block lands.
- `LifeSystem` writes story events through a `story` callback after the
  database confirms: hired, first shift (one key for every shift, so it is
  written once), enrolled, exam result.
- `reportsCli.ts` (`npm run reports`): deletes expired reports, then lists
  the newest for the product owner.

**Client.** `ui/socialController.ts` owns the player card
(`ui/playerCard.ts`: portrait from `ui/screens/portraits.ts`, relationship,
Block or Unblock, Report), the block and report dialogs
(`ui/screens/dialog.ts`, which gained a list of choices), the notes for
level-ups and safety results, and the private lists (blocked players with
their block ids, the story) that the player menu and the character panel
show (`ui/story.ts` words the story and the moments). The player menu
offers *Greet*, *Chat*, *Profile*, *Block…*, *Report…*, or for someone you
blocked *Profile* and *Unblock*.

## A place to live (M10)

Rules and numbers: `GAME_DESIGN.md` "A place to live (M10)"; choices in
D-044.

**Rules (`shared/`).** `life/housing.ts`: rent weeks (Monday to Sunday),
what to do about rent now (`rentStep`: paid, charge, start the grace
period, wait, move), the cheaper room to move to (`cheaperRoomFor`),
cosiness. `homes.ts`: one template per room type (floor, the room's desk,
fixed spots with a category and a facing) and `homeArea`, which builds a
home's layout — walls, desk, the furniture in each spot as an obstacle with
its bed spot or seat, the door back to the square — from its room type and
placements; `placementRefusal` decides what may go where. Comfort is the
sixth need (`needs.ts`: sitting restores it, at the seat's own rate if it
has one). Sleeping is a timed effect whose amounts come from the bed
(`timedEffectFor("sleep", bed)`). `interactions.ts`: the student housing's
door (`HOME_LINK`) offers going home, renting/changing room and moving out;
beds offer *Sleep*; home seats follow the bench rules.

**Server.**
- `housing/housingRepository.ts`: all SQL for homes and furniture, each
  write in one transaction with its ledger row (`applyMoneyChangeIn`), the
  home row locked before the wallet; idempotent by request key, also when
  the same request arrives twice at once.
- `housing/HousingSystem.ts`: each character's home and storage in memory;
  registers the home as an area (`AreaWorlds.setHome`) before the character
  is placed, so a character saved at home comes back there; runs rent each
  tick from `rentStep` (one database write at a time per character, retried
  after a failure); renting, changing room and moving out for the
  interaction system (`HousingHooks`); furnishing, placing and putting away
  for the `furnish`, `place` and `putAway` messages (only in your own home);
  rebuilds the area when furniture moves (standing the tenant up first, and
  putting them by the door if a new piece stands where they were); moves a
  tenant who lost their home into the new one or out to the housing's door;
  sends `housing` to its owner only.
- `seats.ts` (`SeatBook`): seat reservations; ids under `home/` stay in a
  server-only map, everything else in the replicated `state.seats`.
- `InteractionSystem`: the housing door resolves `HOME_LINK` to the
  player's own home (`homeLink`), `rent` and `move_out` wait for the
  database like hiring; `sleep` is a seated timed action that stands you up
  when it ends or is interrupted; `interrupt` stops an action and stands
  the character up (housing calls it before changing the room).
- `PlazaRoom` wires it: `prepare` before placing a loaded character (a saved
  home area counts only if it is still the character's current home),
  `attach`/`detach`, `resync` after a reconnection, `onArrivedHome` (the
  cosy-home mood) after a door into your own home, the seat comfort for the
  life system, and the three messages under the intent rate limit.

**Client.** `ui/housingController.ts` keeps the home and storage the server
sent, builds the home's room (`homeArea`, cached until it changes), shows
rent notices, and runs the rent and move-out dialogs; `ui/homePanel.ts` is
the furnishing panel (one fold-out per spot: put away, place from storage,
buy; redrawn only when its contents change); `ui/housing.ts` words rent,
cosiness and notices. `game.ts` resolves a home area through the
controller, waits for the `housing` message if the player's area arrives
first, rebuilds the room you stand in when its furniture changes
(`WorldScene.dispose` frees the old one) and drops a home's scene when you
leave it. Furniture art: `render/world/props.ts` (bed, armchair, beanbag,
potted plant, floor lamp; the chair and bookshelf builders are reused); the
sleeping pose lies the character along the bed (`render/avatar/character.ts`).

## Non-player characters (M11)

Rules and numbers: `GAME_DESIGN.md` "Locals: non-player characters (M11)";
choices in D-045.

- **Rules (`shared/`).** `npcs.ts`: the roster and schedules as data, and
  pure functions — the block at a game minute (`npcBlockAt`), the order of a
  block's places for the hour (`npcPlacesInOrder`), the greeting line
  (`npcGreetingLine`), and `npcMayUse`, which keeps seats and spots free for
  players. `interactions.ts`: a player can only greet an NPC
  (`playerActions` with `npc`).
- **Server.** `npc/NpcSystem.ts` gives each NPC a small mind: every
  `NPC_CONFIG.thinkIntervalMs` (staggered) it compares what the NPC is doing
  with its schedule and, only if it no longer fits, asks the interaction
  system for the next thing — a door towards the right area, or a free
  designated place — exactly as a client's `interact` would (validation,
  reservation, walking, timers all unchanged). It spawns an NPC at its
  street when its day starts and despawns it there when it ends, answers
  greetings and waves. `npc/npcHooks.ts` (`withNpcs`) wraps the life hooks:
  NPCs are never charged, paid, hired, enrolled or recorded; the barista's
  job and shifts need no life data. `PlazaRoom` adds NPCs to the player map
  with a `role` and no session (so `StateView` shows them per area), walks
  them like a player's tap, and leaves them out of saving. The social
  system finds no account behind them, so cards, blocks and reports do
  nothing. `NPCS=off` turns them off; server tests have them off unless a
  test turns them on.
- **Tick budget.** `PlazaRoom` times every simulation tick (`tickStats.ts`,
  a rolling window) and logs the average, p95 and maximum every five
  minutes against `NPC_CONFIG.tickBudgetMs` (5 ms of the 50 ms tick; a
  warning above it). A server test measures it with every NPC active.
- **Client.** The replicated `role` puts a gold tag with the role on the
  NPC (`render/avatar/avatar.ts`); the player count and the debug hook's
  `players()` leave NPCs out (`npcs()` lists them); the menu says "not a
  player" and offers *Greet*; a greeting's answer arrives as `greeted` with
  a `line`.

## From a player action to saved state (implemented)

The same path for every action, shown with buying a panino. Which values
are replicated, private or persistent is the table in `NETWORKING.md`
"Model"; when each is written is `DATA_MODEL.md` "What is saved when".

1. **Intent.** A tap becomes `interact {targetKind: "object", targetId:
   "cafe-counter", action: "buy", itemId: "panino", requestId}`. The client
   changes nothing but presentation (selection, menu); it never sends a
   price, a result or a position.
2. **Validation, before anything changes.** `parseInteract` checks the shape
   (`shared/src/protocol.ts`); `validateObjectAction` checks the rules over
   the server's own state (`shared/src/interactions.ts`); the
   `checkStart` hook checks life rules (too tired, can't afford). A refusal
   is an `action` message with a reason; nothing is reserved or charged.
3. **Reservation and walking.** A standing spot (or seat) is reserved in the
   replicated `state.seats`, a path is planned, and the server walks the
   character there; everyone sees the movement through state patches.
4. **Execution on arrival.** For the café, the `purchase` hook runs the
   money transaction (`applyMoneyChange`: row lock, balance check, ledger row,
   idempotent by `purchase:<requestId>`). It is **persistent at once**, before
   any food is served. Then `activity` becomes `eating` (replicated).
5. **Effects over time.** `LifeSystem` applies the effect to the in-memory
   life (hunger, energy, mood event) in proportion to elapsed time; the owner
   receives private `life` messages; other players see only "eating".
6. **Completion or interruption.** `action` with `completed`, or
   `cancelled`/`failed` with a reason; a payment interrupted before eating
   starts is refunded with its own idempotent ledger row (D-025).
7. **Saving.** Money was saved in step 4. Needs, skills, mood events and
   position are saved together at the save points (leaving, back to the
   title, eviction, room close, the 30 s autosave, after an action that gave
   skill XP). Seats, activity and the pending action are never saved.

**Rule for new systems** (the convention this pattern sets; M7's wages and
M8's lectures and grades follow it): a new valuable change (a wage, a grade, a relationship step, an
item) is an intent from the client, a pure rule in `shared/`, a server check
over server state, and a write in a repository transaction scoped by the
owning account, with an idempotency key when a repeat could pay or grant
twice. Only what other players need to see is replicated; private values go
to their owner in a direct message. Each system states when it saves:
immediately for anything of value, at the save points for state that changes
continuously.

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
in one transaction, rate-limited per IP; more characters for an existing
account up to the limit, D-031), lists and deletes an account's characters,
deletes a whole guest account (M12, D-046), updates appearance and saves position. Validation rules live in `shared/src/profile.ts` (names, age
categories, version upgrades) and `shared/src/appearance/` (appearance).

**Room lifecycle (`server/src/PlazaRoom.ts`).**
- Any join → the lobby (title screen); nobody is placed in the world until
  `enterWorld` or `createCharacter` (see "Room lifecycle, title screen" below).
- `createCharacter` → validated, stored (`identity {guestToken}` sent once for a new guest account), character spawned.
- `enterWorld` → the saved character is loaded and spawned at its saved
  position (spawn point if that spot is no longer walkable).
- `updateAppearance` → validated as a complete appearance config, saved (document plus the M4 projection), replicated as one `look` string.
- Leave, eviction, room disposal → position and life data saved; autosave
  every 30 s for every character in the world (since M5).
- Same account entering the world from a second session → the newest wins
  (D-018, `profiles/sessionRegistry.ts`); the older one is saved first and
  closed with code 4100. A new session waits for an in-flight save before
  loading. Only looking at the title screen claims nothing.
- Brief network drop → same session resumes within 20 s; nothing reloads.

**Room lifecycle, title screen (D-031).** Joining puts a session in the
lobby: `profile {status: "lobby"}` lists its account's characters and no
character is in the world. `enterWorld` (an id of the session's own account)
or `createCharacter` claims the account (newest session in the world wins),
loads or creates the character and spawns it; `leaveWorld` saves it, removes
it and returns the lobby; `deleteCharacter` (title screen only, name typed,
not while played anywhere) deletes it with all its data. One profile request
runs at a time per session (`busy` otherwise).

**Client.** `main.ts` applies device settings, builds the game view and
starts `ui/flow.ts`, which drives the screens around the world:

| Module | Role |
| --- | --- |
| `ui/flow.ts` | The page flow: title → new life (setup → creator → review) or Continue → entering transition → world; Manage characters, Settings, Credits; editing a look (title screen or world); back to the title; errors and timeouts of pending requests |
| `ui/screens/screenHost.ts` | Shows one full-screen screen at a time in `#screens` (Escape = back), hides them all while playing |
| `ui/screens/titleScreen.ts`, `backdrop.ts` | Title menu and the key visual (starry sky, porticoes) drawn in SVG by code |
| `ui/screens/setupScreen.ts` | Name and personality |
| `ui/screens/creatorScreen.ts`, `ui/creator.ts` | The creator (live 3D preview: drag/touch to turn, wheel/pinch/buttons to zoom; six categories: Appearance, Face, Hair, Body, Clothing, Accessories; starting looks; randomise all or one category; reset a category; undo/redo; hold to compare; look codes) and the review step with the final confirmation |
| `ui/screens/manageScreen.ts` | Character list: Play, Edit look, Delete (with typed confirmation), New life |
| `ui/screens/infoScreens.ts` | Settings, Credits, the entering/leaving transition, plain messages |
| `ui/screens/portraits.ts` | Portraits of the real 3D characters for menus, drawn by one short-lived offscreen renderer and cached |
| `ui/settings.ts` | Device settings in `localStorage` (graphics, camera speed, interface motion, controls reminder) |

The creator groups the config into player-facing categories with the pure
helpers in `shared/src/appearance/categories.ts` (which field belongs where,
per-category randomise and reset, the plain-language review summary).
Choices that are covered by another (hair under a headscarf, top under a
full outfit) are labelled "saved, but not visible right now". The preview
renders only when something visible changes, except for the review
turntable. Nothing is sent to the server before the player confirms on the
review step; cancelling with changes asks first.

If a body part can't be built from a look (a renderer bug), `CharacterModel`
draws that part from the default look, reports it in its stats, and the
creator tells the player; other parts and other players are unaffected.

**Services wiring.** `app.ts` builds a `ProfileService`, `LifeService` and
`SessionRegistry` per game server and registers them under a key passed in room options
(`services.ts`), so rooms never receive live objects through options.

## Indoor rooms (M7c, D-038, D-039)

**Built:** the square and two rooms (the hall's lecture room, the library's
reading room) as **areas inside the one server room** (option C of the
comparison recorded in D-039; the other options were rooms modelled in place
inside the 4.5–6 m deep shells, or one Colyseus room per interior).

- **Data (`shared/`):** `areas.ts` lists the areas (`plaza`,
  `hall/lecture-room`, `library/reading-room`), each a layout in the same
  collision-first format as the square (D-033); rooms are built in
  `interiors.ts` (walls are obstacles of kind `wall`; desks, chairs, a
  lectern, a board and shelves). A **door** is an interactable of kind
  `door` with a `door` link (`to` area, `door` id there, the menu wording);
  doors come in linked pairs, and `doorArrival` puts you in front of the
  linked door, facing away from it. Object and seat ids are unique across
  all areas (tested), because seats share one map in the server state.
- **Server:** `server/src/areas.ts` builds one layout and navigation grid
  per area; `PlayerRuntime.area` says where each character is; movement,
  collision, pathfinding, seats and interactions use that area
  (`InteractionDeps.area(sessionId)`). The door action follows the usual
  lifecycle (validate, walk to a spot in front of the door, then on arrival
  `enterArea` moves the character); greetings and object actions only reach
  the same area. Going through a door resets the walking distance, so the
  jump gives no fitness.
- **Replication:** the player map is filtered per client with a Colyseus
  `StateView` (`t.map(PlayerState).view()`): each client receives only the
  players in its own area, and nobody while at the title screen (the map is
  then absent on the client). `refreshViews()` runs when someone enters the
  world, changes area or reconnects. The seat map is not filtered (it holds
  seat ids and session ids only).
- **Saving:** `character_state.area` (exists since 0001) stores the area;
  a character comes back in the room and spot it was saved in, or at the
  square's spawn points if that area no longer exists or the spot is
  blocked.
- **Client:** one scene per area (`Game.scenes`); the square is built after
  the title screen appears, a room when first entered. `buildWorldScene`'s
  interior mode draws the room from `buildInterior` (the props of its
  layout and a rug), uses the room's floor as the ground, a fixed warm
  indoor light, no sky, haze or day/night. When your own player's `area`
  changes, the game moves the avatars to that scene, hides the players of
  the area you left until the server removes them, snaps the camera and
  covers the cut with a short fade. Walls and the room's door on the
  camera's side are cut away (they fade while the camera is outside the
  room on their side); the faded door stays tappable, because it is the
  way out. The interaction controller reads the current area's layout.
- **Homes (M10)** are areas too (`home/<id>`), added and removed while
  their tenant is in the world; see "A place to live (M10)".
- **Not built yet:** rooms for the other buildings (each arrives with its
  use, one room per use: D-039), shared flats, windows inside rooms, and
  filtering the seat map (home seats are kept out of it instead).

## Operations (M12 part 1, D-046)

**Health and status (`server/src/status.ts`).** `mountStatusRoutes` adds
`GET /health` and `GET /status` to the HTTP server Colyseus's transport
already runs (the `express` option of the server in `app.ts`). Rooms report
themselves through `StatusSource` (`PlazaRoom.statusSummary`: players, NPCs
and the tick statistics from `tickStats.ts`); they register in
`GameServices.rooms` when created and leave it when disposed. Only
aggregate numbers leave the server (NETWORKING.md "HTTP").

**Logs (`server/src/log.ts`).** Readable lines by default; `LOG_FORMAT=json`
writes one JSON object per line (`time`, `level`, `scope`, `message`) for a
hosting provider's log collector. Log messages name sessions and character
ids, never guest tokens.

**Deleting a guest profile.** `PlazaRoom.handleDeleteProfile` checks the
session (title screen, the typed word, an account, no character in play)
and deletes through `ProfileService.deleteAccount` inside the session's
exclusive section; every session of that account loses its account id, is
told (`profileDeleted`) and gets an empty lobby. The client
(`client/src/ui/flow.ts`) forgets the stored token.

**Load test (`server/src/loadtestCli.ts`, `npm run loadtest`).** Bot
players built on the Colyseus client SDK (a server dev dependency) join a
running server as guests, play for a while, read `/status`, and delete
their profiles at the end. Results in TESTING.md.

## Deployment options for Q15 and Q16 (Proposed, for the product owner)

Nothing here is decided or built. It compares the ways to put the game
online for the first test with people outside the project (M12 part 2),
so the product owner can answer Q15 (hosting, domain, budget) and Q16 (the
accounts sign-in needs). Prices were read on 2026-10-28, partly from
third-party summaries; several providers raised prices in 2026, so check
the provider's own page when signing up.

**What the game needs.** One always-on Node.js 22 process (Colyseus with
WebSockets; one process, because sessions and the guest-creation limit live
in its memory); PostgreSQL 16 with daily backups and a restore that has
been tried; HTTPS/WSS; the built client's static files; an EU location
(players in Italy, GDPR). Measured load with 16 players and the locals:
about 150 MB of memory and under 10 % of one CPU core (TESTING.md, M12 load
test). Serverless function hosts (Vercel, Netlify functions and the like)
can't hold WebSocket rooms, so they are out.

| | A. One small EU server for everything | B. EU server + managed PostgreSQL | C. Platform service, EU region |
| --- | --- | --- | --- |
| Example | Hetzner Cloud CPX12 (1 vCPU, 2 GB, Germany or Finland) or a DigitalOcean 2 GB Droplet (Frankfurt) | DigitalOcean in Frankfurt: a 1 GB Droplet for the game + Managed PostgreSQL (1 GB) | Render in Frankfurt: a 512 MB web service + Render Postgres + a free static site for the client |
| Monthly cost (approx.) | about €14 (Hetzner) or $15 (DigitalOcean), backups included | about $22 ($6 + $1.20 backups + $15) | $13 with the 256 MB database, $26 with the 1 GB one |
| Who keeps it running | Us: system updates, PostgreSQL, HTTPS (Caddy renews certificates by itself), a nightly database dump copied off the machine | Us for the game server; the provider for the database (daily backups, point-in-time recovery) | The provider; deploys from GitHub on each push |
| Backups and restore | Provider's daily server copies (7 kept) + our nightly `pg_dump`; we test a restore | Provider's; we test a restore | Point-in-time recovery for 3 days (Hobby workspace); we test a restore |
| Good | Cheapest, full control, everything in one place | Database safety handled; still cheap | Least for the owner to do; HTTPS and deploys automatic |
| Less good | Most steps for the owner (SSH key, firewall); one machine for everything | Two pieces to set up; we still patch the server | Less control; each deploy restarts the process and drops players for a moment; costs grow faster with size; less than one CPU on the $7 plan (to be checked with the load test there) |

**Recommendation: C (Render, Frankfurt) for the first tests**, because it
asks the least of the product owner as operator and fits the measured load,
with A as the cheaper choice if the budget is tight. Either way a **domain**
costs about €10–15 a year (.com, .it or .eu). It must not suggest a link
with the University of Padua (no "unipd", no university names or logos).
Rough budget: €25–35 a month with C and the 1 GB database, domain included.

**Q16, the accounts sign-in needs (D-042).** Both are created and owned by
the product owner; their secrets go only into the host's environment
settings, never into the repository or a chat.

1. *Google sign-in* (free): in the Google Cloud Console, create a project,
   set up the OAuth consent screen (external; app name, support email; the
   basic scopes openid, email and profile) and create an OAuth client of type
   "Web application" whose redirect address is on the game's domain (plus
   `http://localhost` for development). It gives a client id and a client
   secret. So the domain comes first.
2. *An email-sending service* for confirming addresses and resetting
   passwords:

   | Service | Free allowance | First paid plan | Note |
   | --- | --- | --- | --- |
   | Resend | 3,000 a month, 100 a day, one domain | $20 a month | Simple API |
   | Brevo | 300 a day (with Brevo's logo in the email) | $9 a month | EU company |
   | Amazon SES | none to speak of | about $0.10 per 1,000 emails | Most setup |

   Recommendation: **Resend's free allowance** for the tests. Each needs
   DNS records on the domain (SPF and DKIM) so emails aren't marked as spam.

**Order once the answers are in:** buy the domain → create the host
account (the owner pays; Claude writes the step-by-step) → email service
and its DNS records → Google client with the domain's redirect address →
Claude builds sign-in and the deployment configuration, and tries a restore
from a backup before anyone outside the project plays.

Sources (read 2026-10-28): [Hetzner prices 2026](https://agentdeals.dev/hetzner-pricing-2026),
[Render pricing](https://render.com/pricing),
[DigitalOcean pricing summary](https://kuberns.com/blogs/digitalocean-pricing/),
[managed PostgreSQL comparison](https://sliplane.io/blog/cheap-managed-postgres-providers),
[Scaleway managed databases](https://www.scaleway.com/en/pricing/managed-databases/)
(another EU option: about €11 a month for its smallest PostgreSQL, Paris),
[Resend free tier](https://automationatlas.io/answers/resend-free-tier-explained-2026/),
[Brevo plans](https://dreamlit.ai/blog/brevo-review).

## Not yet decided or built

- UI framework for larger panels (inventory, build mode). Plain DOM was
  enough for M3 menus and the M5 character panel; see D-007.
- Real sign-in: decided (sign in with Google and with email and password; guests can upgrade without losing characters, D-042), to be built in M12.
- Moderation decisions (warnings, mutes, bans) and the owner's admin page for reports (M12, D-042; the page needs a signed-in account, so it comes with sign-in); text chat.
- Hosting, managed PostgreSQL and backups (Q15; options compared in "Deployment options for Q15 and Q16"). Health checks, status, JSON logs and a load test exist (M12 part 1).
- Authored character models (rigged glTF/VRM) to replace the procedural
  Stage-1 characters — requirements in `ASSET_PIPELINE.md`.
- Level of detail for characters (far characters still use full geometry)
  and spreading character builds over several frames when many players join at once.
- Real light from lamps on walls and characters (night lamplight is painted
  on the ground and in emissive glass; no point lights, to spare phones).
- Per-object level of detail for the world (two detail levels by quality
  profile exist; distance LOD doesn't).
- Camera collision: the camera can stray into buildings near the edges;
  they fade (D-033) instead of the camera moving closer.
- Deployment pipeline.
