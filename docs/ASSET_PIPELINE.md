# Asset pipeline

## Current state

There are **no authored art assets** in the repository: no models, textures,
rigs or animation files. Everything visible is generated in code:

| Content | Where | Status |
| --- | --- | --- |
| The first district: six buildings, street furniture, plants, paving, streets beyond the square, skyline landmarks, sky (world art pass) | `client/src/render/world/` (kit, buildings, props, ground, backdrop, signs) assembled by `client/src/render/worldScene.ts`, inside the collision boxes of `shared/src/world.ts` | **Stage-1 procedural environment art** (D-033): original, generated in code, not artist-authored. See "World" below |
| Paving slabs and all signs (shop fascias, inscriptions, clock face) | Drawn at runtime on two small canvases (`ground.ts`, `signs.ts`) | Generated in code; no image files |
| Characters: parametric bodies, faces, hair, clothing and accessories built from code-generated geometry (M6) | `client/src/render/avatar/` from the appearance config in `shared/src/appearance/` | **Stage-1 procedural art** (D-027): real, distinct geometry for every option, but not artist-authored models. See "Characters" below |
| Clothing patterns (stripes, checks, dots, geometric print) | Small textures drawn at runtime on a canvas (`client/src/render/avatar/patterns.ts`) | Generated in code; no image files |
| Flat colours and toon shading | — | Shared material palette |
| Title screen key visual (starry sky, porticoes, bell tower, domes) | SVG drawn in code, `client/src/ui/screens/backdrop.ts` | Original, generated in code; no image files |
| Interface icons (categories, camera, undo…) | Inline SVG, `client/src/ui/screens/icons.ts` | Original line icons drawn for this game |
| Character portraits in menus | Rendered at runtime from the real 3D characters (`client/src/ui/screens/portraits.ts`) | Generated; nothing stored |

**Third-party assets bundled (since the title screen milestone):** two fonts,
installed from npm and served by the game itself (no requests to Google):

| Asset | Package | Licence | Used for |
| --- | --- | --- | --- |
| Dela Gothic One (© 2020 The Dela Gothic Project Authors) | `@fontsource/dela-gothic-one` 5.3.0, Latin subset, weight 400 | SIL Open Font License 1.1 (the package wrapper is MIT) | Logo, screen titles, character names |
| M PLUS Rounded 1c (© 2016 The Rounded M+ Project Authors) | `@fontsource/m-plus-rounded-1c` 5.3.0, Latin subset, weights 500/700/800 | SIL Open Font License 1.1 | All other interface text |

The OFL allows bundling and redistribution with the game; the fonts must
not be sold on their own and their licence text ships inside the npm
packages. Both are credited in the in-game Credits screen. Only the Latin
subset is loaded (about 20 KB per weight as woff2); other scripts fall back
to system fonts glyph by glyph. No other third-party models, textures,
sounds or icons are bundled.

## Interface (title screen milestone, D-032)

Palette tokens live at the top of `client/src/styles.css`:

| Token | Value | Use |
| --- | --- | --- |
| `--lapis` | `#1d2f7a` | Night-blue headers, selected options, in-world buttons |
| `--lapis-night` / `--lapis-deep` | `#0d1540` / `#121c4f` | Title sky, hard shadows |
| `--gold` | `#f2c14e` | Stars, focus rings, selection accents, trait chips |
| `--spritz` | `#ff7438` | The one main action per screen (always with dark text: 5.8:1) |
| `--intonaco` | `#f3f4fb` | Panels and menu ribbons (plaster white) |
| `--ink` / `--ink-soft` | `#17204a` / `#4a5280` | Text on light surfaces (14:1 / 7.5:1) |

Rules: one main action per screen in Spritz; gold only for selection and
focus; text on the blue sky is white or `#c8cff5`; new screens reuse the
`flow-header`, `ui-button` and `screen` classes instead of new styles.
Every interactive element is at least 44 px tall on touch screens.

## Characters (M6)

**Supported avatar format today (implemented).** The game loads **no avatar
files**. The only character format is the appearance config
(`shared/src/appearance/`, D-028): a versioned JSON document of option ids
and 0–1 sliders. Every client turns it into a 3D character with the
procedural builder in `client/src/render/avatar/` (D-027). There is no glTF,
VRM or FBX loader in the project.

**How characters load today (implemented).**
- **Other players:** each player's look arrives once as the replicated
  `look` string; the client decodes it (`decodeLook`, never throws) and
  builds the character on the main thread when that player first appears
  (23–132 ms each on the cloud machine, see "Measured cost"). A later look
  change rebuilds only the parts whose inputs changed.
- **When:** avatars are built only once this client is in the world (not
  while it sits at the title screen); the creator and menu portraits build
  their own preview characters on demand, and starting-look portraits are
  drawn as they scroll into view.
- **Nothing is downloaded,** so there is no loading screen or cache for
  characters; garment pattern textures are drawn on small canvases on first
  use and shared.
- **Failure handling:** an unreadable or newer look draws the default look;
  a body part that fails to build is drawn from the default look and
  reported (ARCHITECTURE.md).

**Proposed: loading authored avatars (not built; deferred: on 2026-10-27 the owner chose to keep the procedural characters for now and to be asked again before the first public test, Q6 → A, D-041).** If
artist-made models replace the procedural builder (ROADMAP decision Q6), the
recommended approach keeps the appearance config as the contract:
- One shared humanoid skeleton in glTF 2.0 binary (`.glb`), loaded with
  Three.js's own `GLTFLoader` (part of the `three` package already in the
  project, MIT). VRM 1.0 files would need `@pixiv/three-vrm` (MIT; npm
  version 3.5.5 declares support for `three` ≥ 0.137; not installed or
  tested here); choose one format before commissioning art.
- One file per option id (body base, each hair style, each garment),
  fetched **on demand** when a look needs it, cached per id, and shared by
  every character that uses it; the title screen preloads the base body
  and the most common pieces.
- While a piece downloads, or if it fails, the character shows the
  procedural part for that option, so a missing file never breaks a look.
- Compression (Meshopt geometry, KTX2 textures) evaluated against the mobile
  budget below; files served by the game itself with long-lived caching.
- The same budgets, naming and licence rules as "Requirements for authored
  character assets" below.

**What exists.** Characters are assembled in code from parametric pieces: a
body (torso, arms, legs) shaped by frame, build and proportion values; a head
deformed by face shape and sliders; anime-style eyes, brows, nose and lips
drawn as small geometry; hair built either as shells that follow the head's
surface (so hair always fits the face shape) or as strands (braids, locs,
twists); clothing layers; accessories. Every option in the catalogue changes
the actual geometry or colour. No menu option is a label without a visible
change.

**What it is not.** These are not artist-made models. There is no skeleton
rig: animation is procedural (limb rotations for walking, sitting, waving).
There are no facial expressions, no cloth simulation and no hair physics.
Quality is "readable stylised prototype", not final art. Known visual
limitations, seen in the character lab:
- Hands are mittens (no fingers); the mouth never moves.
- Afros, curls and coils are bumpy volumes with curl clusters, not
  strand-level detail; at close range hairlines show small steps.
- Tank-top and dress straps have soft, slightly blotchy edges at the shoulders.
- Legs swing inside rigid long skirts and coats when walking (the stride is
  shortened to hide most of it); seated, skirts switch to pieces on the legs.
- The headscarf drape is a simple flared shape; there are no folds or ties.
- No ink outlines; shading is a soft two-tone cel ramp.

**How it fits together.** Hair, beards and headwear are built from the
deformed head surface, so they follow every face shape; hanging hair (locs,
braids, long hair) is swept along paths that keep clear of the face,
shoulders and torso; skirts and coat tails switch to leg-attached pieces
when seated so the legs never pass through them; sleeves, trousers and shoes
are part of the limb meshes, so they move with the poses. Covered choices
(hair under a headscarf or hat, top and bottom under a full outfit) are not
drawn, and the creator says so (`shared/src/appearance/layers.ts`).

**Measured cost** (this cloud container: 2 vCPU, software WebGL; not a
representative player device, see "Not measured" below):

| Measure | Result |
| --- | --- |
| Triangles per character (17 presets) | 14 200 – 24 400 (budget enforced by e2e: under 30 000); box braids and long curls are the heaviest |
| Meshes (draw calls) per character | 8 – 12 (budget: at most 14) |
| Materials | 1 shared vertex-colour material for every character, plus 1 per pattern-and-colour in use (shared) |
| Textures | Patterns: 128 × 128 canvases (about 85 KB each with mipmaps), created on first use; no image downloads |
| Full build of one character (JavaScript, this machine) | 23 – 132 ms, 48 ms on average over the 17 presets; the first build on a page is the slowest |
| Piazza with 4 diverse characters (e2e, one of four browsers) | 121 draw calls and 152 000 triangles per frame including the world and shadows; 2.3 ms of JavaScript per frame; about 10 fps because four browsers shared two CPUs in software rendering (not a meaningful frame rate) |
| Client bundle | 880 KB (245 KB gzipped) at M6, up from 769 KB (208 KB) in M5; the lab page is a separate 7 KB entry. Current size (after the title screen and the district): see TESTING.md "Known issues" |
| Rebuild after one change in the creator | head only for hair, face or headwear changes; torso + arms for a top; every part for body sliders |
| Loading | Nothing to download: characters are generated on demand; starting-look portraits are drawn one at a time as they scroll into view (since M6b) and cached |

**Not measured yet:** frame rate and memory on a real phone or a normal
laptop GPU, and build times on those CPUs. Expect builds to be several
times faster on a current laptop. Known risk: when many players join at once,
each character's build runs on the main thread (a short stall per player);
spreading builds over frames and a lower-detail version for distant
characters are planned, not implemented.

**Character lab.** `client/lab.html` (see README) renders every preset and
option with its triangle count and build time; use it to check new options
by eye before committing.

**The appearance config is the contract.** Saved characters store a
versioned appearance configuration (`shared/src/appearance/`, D-028) with
stable option ids and 0–1 slider values. When authored models arrive, they
replace the renderer behind the same ids, without a data migration.

**Requirements for authored character assets (future).** If an artist or
asset source becomes available:
- Format: glTF 2.0 binary (`.glb`) or VRM 1.0, one shared humanoid skeleton
  for every body, so hair, clothes and animations interchange.
- Body variation: morph targets (blend shapes) named after the config sliders
  (`height`, `shoulders`, `torso`, `legs`, `arms`, per build), and face morphs
  (`cheekbones`, `jaw`, `chin`, `forehead`, `eyeSize`, `eyeSpacing`,
  `noseWidth`, `noseLength`, `lipFullness`, `browHeight`) with the 0–1 range
  meaning the same as today's procedural mapping (documented in
  `shared/src/appearance/schema.ts`).
- Hair, clothes and accessories: separate meshes skinned to the same skeleton,
  one file per option id (`chr-hair-<id>.glb`, `chr-top-<id>.glb`…), with a
  greyscale albedo so colours stay data-driven.
- Skin: one shared skin material for face and body (no separate face texture
  tint), so every tone matches across body parts.
- Budget (mobile): about 20k triangles and ≤ 4 materials per assembled
  character; textures ≤ 1024 px, shared atlases.
- Licence: original work, or a licence that explicitly allows commercial use
  and modification. Record source and licence in `CREDITS.md` before committing.

## World (world art pass, D-033)

The first district is built in code from a small modular kit, like the
characters. Nothing was downloaded or licensed: every model, texture and
sign is original and generated at runtime. It is **Stage-1 procedural art**
(consistent and complete, but not artist-made production assets).

**Art direction (implemented in the first district; the standard for new areas)**

- **Feel:** warm, colourful and inviting, contemporary student life in a
  historic Italian centre; stylised, not photoreal. Simple, chunky shapes
  that read at the game camera's distance (about 11 m), soft toon shading
  shared with the characters (D-030, D-033), no ink outlines.
- **Padua as inspiration, not a replica:** plastered façades in cream, ochre,
  apricot, pink and sage; green shutters and wrought iron; Istrian-stone
  trims; trachyte paving; terracotta roofs; porticoes; copper domes and a
  brick bell tower on the skyline. Places are fictional composites with
  generic names ("Palazzo degli Studi"); real landmarks appear only as
  generic silhouettes; no real shop names, logos or university insignia
  (the game must not imply affiliation). A district modelled on real streets
  would need verified references and be marked as real in data.
- **Palette:** one palette for the whole world (`render/world/palette.ts`),
  grouped as plasters, stone and trachyte, brick and roofs, shutters and
  ironwork, glass, foliage and flowers, plus the interface accents (lapis,
  gold, Spritz orange) used sparingly for signs, banners and awnings so the
  world and the menus belong together (D-032).
- **Lighting (day and night, M7b, D-037):** one directional light (the sun
  by day, a cool moonlight by night; shadows from a 2048 px shadow map with
  Three.js's default filtering on the high profile, none on phones), a sky /
  earth hemisphere fill, a gradient sky dome with clouds, and distance haze
  that hides the outer ring. All of them follow the server's game minute
  through dawn (05:15–07:30), day, dusk (18:30–21:30) and night, from a
  table of key moments in `render/world/daylight.ts` (16:00 is the world art
  pass's original afternoon). The sun rises in the east at 06:15, crosses
  the south and sets in the west at 19:45, never lighting from lower than
  14°.
- **Night:** the street lamps' and porch lanterns' glass, about 40 % of the
  windows (the same ones every night, chosen by position), the shop windows
  and the café's pastry case glow warm; pools of lamplight lie under the
  lamps, the kiosk and the hall's porch; stars and a moon come out. The
  square stays readable: the ambient light keeps at least 55 % of midday's,
  and characters add a little of their own colour as light (up to 20 %), so
  they keep their contrast with the ground (measured in
  `e2e/daylight.spec.ts`). Name tags, menus, rings and highlights are not
  lit by the scene and look the same at any hour.
- **Readability rules for new work:** what can be used looks usable (seats,
  counters and desks at real heights, a clear front side); what blocks
  movement is visibly solid and fills its collision box; the edge of the
  walkable area is something you can see (planters, kerbs), never an
  invisible line; signs and text stay legible on a phone; every new piece
  passes the art-against-collision test.

**Where things are**

| Module | What it builds |
| --- | --- |
| `render/world/palette.ts` | The one palette: plasters, Istrian stone, trachyte, terracotta, shutters, foliage, accents from the interface (D-032) |
| `render/world/kit.ts` | Geometry helpers: boxes, cylinders, rods, rings, lumpy blobs (foliage), flat inlays, striped quads, hip and gable roofs, a façade frame (build in u along the wall, v up, w out of it), arch shapes, a fast quad batch for things that come in thousands, two-sided thin surfaces |
| `render/world/buildings.ts` | The six buildings: windows (frames, sills, shutters, pediments, balconies, flower boxes), doors, shopfronts, awnings, rustication, cornices, roofs, chimneys, the hall's porch and clock tower, the library's pediment and dome, the portico's columns and arches |
| `render/world/props.ts` | One builder per obstacle kind: benches, chairs, study desks, café tables with parasols, the café kiosk, market stalls (fruit and vegetables, flowers, books), the fountain, lemon-tree planters, street planters, plane trees, gardens, lamps, the bike rack, the notice board; home furniture (M10): beds (frame, mattress, blanket, pillow, headboard; colours by bed), armchairs, beanbags, potted plants, floor lamps with a shade that glows at night (chairs and bookshelves reuse the chair and shelf builders) |
| `render/world/ground.ts` | Canvas paving texture, sidewalks, cobbled streets, fountain rings, the café terrace |
| `render/world/backdrop.ts` | City blocks around the square, the streets beyond the openings (each ending at a building), landmarks, sky dome (repainted with the time of day) and clouds, the night sky (stars and moon) |
| `render/world/daylight.ts` | The light at any game minute: sun or moon direction, colours and strengths, sky, haze, cloud tint, lamp level, stars, the characters' night lift (pure, unit-tested) |
| `render/nightShading.ts` | The two shader additions and their shared uniforms: glow for world materials, lift for character materials |
| `render/world/district.ts` → `buildInterior` | An indoor room (M7c): the props of its layout (walls, door, furniture) and a rug; the floor is the ground plane |
| `render/world/signs.ts` | The sign atlas (one canvas, fictional names only) |
| `render/world/district.ts` | Assembles everything as owned pieces; fade volumes |

**Conventions (dimensions and materials)**

- 1 unit = 1 metre, Y up, X east, Z south; origin at the centre of the square.
- Walls stand `WALL_INSET` = 0.15 m inside their collision box; details
  below head height stand out at most 0.15 m, so they stay inside it.
- **Head height is 2.2 m.** Below it, every solid piece lies inside the box
  it belongs to (tolerance 0.06 m); above it, balconies, awnings, eaves,
  parasols, lanterns and canopies may overhang walkable ground.
- Storeys: ground floors 3.6–5.4 m, upper floors 2.9–4.4 m; windows about
  0.9–1.5 m wide; doors 1.1–2.1 m; benches and chairs have their seat at
  0.45 m (the characters' sitting pose sits at 0.5 m, D-030).
- Every piece has an owner (an obstacle id) or is decoration (owner null),
  a draw batch, and a glow strength per vertex (`glow` attribute: 0 for
  almost everything; `glowing(piece, strength)` in `kit.ts` marks lit
  windows 0.85, lanterns 1.3, shop windows 0.45). New lit things are marked
  the same way; windows lit at night are chosen with `litAtNight`. A Node test (`client/test/world.test.ts`) checks owned
  pieces against their boxes, decoration against all boxes, and that every
  box is visibly filled.
- One material: the characters' soft toon ramp (D-030) with vertex colours,
  front faces only; thin surfaces (awnings, parasols, valances) carry their
  own back faces. Separate materials only for water, signs (atlas texture),
  the paving texture and the sky.
- Textures: the paving canvas is 512 × 512 px for 4 m (256 px on phones),
  repeated across the square; the sign atlas is 1024 × 1024 px. Nothing else.

**Performance**

| Measure | High (desktop) | Low (phones) |
| --- | --- | --- |
| District triangles (all pieces, including the night sky and lamplight pools) | about 110 800 | about 63 800 |
| Meshes (draw batches) | 47 (buildings 6 + signs, props 4, clickable objects 12, canopies 9, ground, backdrop, sky, clock hands, water) | 47 |
| Draw calls, overview of the whole square | 86 (including the shadow pass) | 47 (no shadows) |
| Draw calls, game camera at the arrival area with one character | 69–88 | 31 |
| Added at night (stars and moon, lamplight pools; nothing added by day) | 2 draw calls, about 1 400 triangles | 2 draw calls, about 1 400 triangles |
| Build time, measured in the browser on the cloud test machine | 0.4–0.7 s | about 0.3 s |
| Build time in Node, warm (geometry only) | about 0.25 s | about 0.17 s |
| Main-thread time per frame for the world's own work (fading, sky, clock) | 0.02–0.12 ms | 0.02 ms |

- **Merging:** pieces are merged by draw batch, so 8 000+ small pieces
  become 47 meshes (plus two night-only meshes). Repeated small things (cobbles, terrace tiles, distant
  windows) are written straight into one geometry by the quad batch.
- **Culling:** every mesh has a bounding sphere, so off-screen buildings,
  prop quarters, canopies and clickable objects are skipped by three.js.
- **Level of detail:** two detail levels chosen by the quality profile
  (window glazing bars, shutter slats, balusters, cobbles, flower details
  and foliage density drop on phones). Distance fog hides the far ring
  and landmarks. There is no per-object distance LOD yet: the square is
  small enough that everything is close.
- **Loading:** the district is built just after the title screen appears
  (`buildWorldScene(..., { defer: true })`), so the title is not delayed;
  entering the world waits until it is ready. Nothing is downloaded.
- **Night costs no extra lights:** lit windows and lanterns glow through a
  shader uniform on the existing materials, and the pools are additive
  discs, not light sources, so phones do no extra lighting or shadow work.
  The light is recomputed once per game minute (every 6 real seconds).
- **Not measured yet:** frame rate on a real graphics card or phone. On the
  cloud machine (graphics emulated in software) a full-window frame takes
  hundreds of milliseconds and the time shows up inside `renderer.render`,
  which says nothing about real hardware.

**World lab (`client/world-lab.html`, developer page)**: the district
without a server, from preset viewpoints (`?view=overview|game|hall|porch|
library|portico|cafe|market|fountain|street|south|skyline`), with
`?collision` (every collision box as a wireframe, orange for clickable
objects), `?quality=low` (phone detail), `?people` (a few characters for
scale), `?time=HH:MM` (the light at that time of day, default 10:10;
e.g. `06:30`, `19:40`, `23:00`), `?area=hall/lecture-room` or
`?area=library/reading-room` (an indoor room, M7c) and
`?area=home&room=box-room|single-room|studio&furnished=0..3` (a rented
room, M10). It shows the time, build time, triangles and
draw calls on screen.

**Indoor rooms (M7c, D-039):** each room is a layout of its own with
plaster walls 3.4 m high (kind `wall`, with a wooden skirting), a wooden
door in the south wall, a warm wooden floor and furniture from the same kit
(study desks with chairs, a lectern, a blackboard, bookshelves with
coloured spines). Rooms use a fixed warm indoor light and no sky. The walls
and door on the camera's side fade while the camera is outside the room
(cutaway). The square's doors are thin portals in front of the hall's porch
and the library's entrance, drawn in their own batches so they can be
highlighted. Measured in the world lab with five or six characters: about
80–90 draw calls; the lecture room's own geometry is about 3 600 triangles,
the reading room's about 23 000 (the book spines). No windows inside yet.

**Homes (M10):** the rented rooms use the same walls, door, floor, light
and cutaway; three sizes (5.2 × 4.4 m, 6.8 × 5.2 m, 8.4 × 6 m), the room's
own desk with a chair, and fixed spots where furniture stands against a
wall. Each piece is drawn inside its own box (checked for every room type,
empty and furnished, by `client/test/interiors.test.ts`). Measured in the
world lab with two characters: a furnished single room is about 2 100
triangles of room geometry and 40 draw calls; a furnished studio about
2 900 triangles and 44 draw calls. A sleeping character lies along the bed
(pose only; no new geometry). All procedural, Stage-1 like the rest
(D-033); `world-lab.html?area=home&room=studio&furnished=1&people` shows
one.

**Known visual limitations:** flat-shaded, faceted tree canopies; no
interiors behind windows and doors; lit windows are a flat warm colour
(nothing drawn behind them); lamplight pools are painted on the ground, so
lamps don't light walls or characters from the side; stars are small
squares; water is still (no animation); faded buildings show their nearest surface at 16 %
opacity, which looks busy when the camera is inside a building; roof tiles
are colour stripes, not modelled tiles; signs use system serif and sans
fonts drawn on a canvas (the bundled interface font when it has loaded).

## Planned conventions for authored assets

**Characters:** see "Characters (M6)" above. Scale: 1 unit = 1 metre;
adult height 1.56–1.88 m. Animations: retargetable humanoid clips (idle,
walk, sit, sleep, talk). A VRM loader (`@pixiv/three-vrm`) would need its
licence and compatibility checked before being added.

**Environment**
- Format: glTF 2.0 binary (`.glb`), Draco or Meshopt compression evaluated when needed.
- Modular pieces on a 1 m grid, shared texture atlases, baked lighting where practical.
- Collision continues to come from simple data volumes, not render meshes
  (`shared/src/world.ts`). An authored piece replaces one builder in
  `render/world/` and must pass the same test: inside its box below 2.2 m,
  filling its box, with an owner per mesh.
- Dimensions and the palette above apply; texture budgets: 1024 px atlases
  per building set, 512 px for props, mipmapped.

**Naming:** `kebab-case`, prefixed by category, e.g. `env-arcade-column.glb`,
`chr-hair-bob-01.glb`, `anim-walk.glb`.

## Appearance catalogue and saved profiles

Since M6, saved characters store a **versioned appearance config**
(`shared/src/appearance/`): option ids for styles, colours and garments, and
slider values from 0 to 1. Skin tone is a continuous value with an undertone,
not a list of swatches.

- Add an option (a hair style, a garment, a colour): add its id to the
  catalogue and teach the renderer to draw it. No database migration.
- Retire an option: remove it from the catalogue. Characters using it get the
  default on their next load, are saved repaired, and the player is told.
- Change what a field means: bump `APPEARANCE_SCHEMA_VERSION` (and
  `PROFILE_VERSION` if the profile shape changes) with an upgrade step.
- M4/M5 characters (flat `preset`, `skinTone`, `hairStyle`… fields) are
  upgraded automatically on their next load (profile version 2 → 3).
