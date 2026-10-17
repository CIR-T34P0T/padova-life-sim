# Asset pipeline

## Current state

There are **no art assets** in the repository. Everything visible is
generated in code as a placeholder:

| Placeholder | Where | Replaced by |
| --- | --- | --- |
| Box buildings, stalls, fountain, benches, planters | `client/src/render/worldScene.ts` from `shared/src/world.ts` | Modular environment kit (later milestone) |
| Capsule avatars with a facing cone | `client/src/render/avatars.ts` | VRM characters (M6) |
| Flat colours, no textures | — | Shared material palette |

No third-party models, textures, fonts, sounds or icons are bundled, so there
are no licence obligations yet. The UI font falls back to system fonts.

## Planned conventions (to confirm at M6)

**Characters**
- Format: VRM 1.0 (glTF-based), loaded with `@pixiv/three-vrm` (licence to be checked when added).
- One shared humanoid skeleton for all bodies so hair, outfits and animations interchange.
- Scale: 1 unit = 1 metre; average adult height ~1.65–1.80 m.
- Budget (initial guess, to be measured): ≤ 20k triangles and ≤ 2 materials per character for mobile.
- Animations: retargetable humanoid clips (idle, walk, sit, sleep, talk), glTF.
- Sources: original work, VRoid Studio exports, or assets whose licence explicitly
  allows commercial use and modification. Record each asset's source and licence in
  a `CREDITS.md` entry before committing it.

**Environment**
- Format: glTF 2.0 binary (`.glb`), Draco or Meshopt compression evaluated when needed.
- Modular pieces on a 1 m grid, shared texture atlases, baked lighting where practical.
- Collision continues to come from simple data volumes, not render meshes.

**Naming:** `kebab-case`, prefixed by category, e.g. `env-arcade-column.glb`,
`chr-hair-bob-01.glb`, `anim-walk.glb`.
