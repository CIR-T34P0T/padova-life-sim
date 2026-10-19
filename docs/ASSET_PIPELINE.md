# Asset pipeline

## Current state

There are **no authored art assets** in the repository: no models, textures,
rigs or animation files. Everything visible is generated in code:

| Content | Where | Status |
| --- | --- | --- |
| Box buildings, stalls, fountain, benches, desks, café counter | `client/src/render/worldScene.ts` from `shared/src/world.ts` | Placeholder (greybox). Replaced by a modular environment kit later |
| Characters: parametric bodies, faces, hair, clothing and accessories built from code-generated geometry (M6) | `client/src/render/avatar/` from the appearance config in `shared/src/appearance/` | **Stage-1 procedural art** (D-027): real, distinct geometry for every option, but not artist-authored models. See "Characters" below |
| Clothing patterns (stripes, checks, dots, geometric print) | Small textures drawn at runtime on a canvas (`client/src/render/avatar/patterns.ts`) | Generated in code; no image files |
| Flat colours and toon shading | — | Shared material palette |

No third-party models, textures, fonts, sounds or icons are bundled, so there
are no licence obligations yet. The UI font falls back to system fonts.

## Characters (M6)

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
| Client bundle | 880 KB (245 KB gzipped) in total, up from 769 KB (208 KB) in M5; the lab page is a separate 7 KB entry |
| Rebuild after one change in the creator | head only for hair, face or headwear changes; torso + arms for a top; every part for body sliders |
| Loading | Nothing to download: characters are generated on demand; preset thumbnails are drawn one per frame when the Presets tab first opens |

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

## Planned conventions for authored assets

**Characters:** see "Characters (M6)" above. Scale: 1 unit = 1 metre;
adult height 1.56–1.88 m. Animations: retargetable humanoid clips (idle,
walk, sit, sleep, talk). A VRM loader (`@pixiv/three-vrm`) would need its
licence and compatibility checked before being added.

**Environment**
- Format: glTF 2.0 binary (`.glb`), Draco or Meshopt compression evaluated when needed.
- Modular pieces on a 1 m grid, shared texture atlases, baked lighting where practical.
- Collision continues to come from simple data volumes, not render meshes.

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
