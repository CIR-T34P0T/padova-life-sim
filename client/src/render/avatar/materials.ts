// Shared materials for every character (D-030). Colours live in the
// geometry (vertex colours), so all characters share one toon material;
// patterned garments share one material per pattern and colour. Nothing
// here is per character, so building many characters adds no materials.

import * as THREE from "three";
import { withCharacterLift } from "../nightShading.ts";
import { patternTexture } from "./patterns.ts";

let gradient: THREE.DataTexture | null = null;

/**
 * Soft cel-shading ramp: a light, flat shadow tone and a short, smooth step
 * into the lit tone (anime look without blotchy bands on rounded faces).
 * Shared with the world (render/world/), so buildings and people match.
 */
export function gradientMap(): THREE.DataTexture {
  if (!gradient) {
    const size = 32;
    const data = new Uint8Array(size * 4);
    for (let i = 0; i < size; i++) {
      const x = i / (size - 1);
      const t = Math.min(1, Math.max(0, (x - 0.42) / 0.16));
      const v = Math.round(255 * (0.7 + 0.3 * t * t * (3 - 2 * t)));
      data.set([v, v, v, 255], i * 4);
    }
    gradient = new THREE.DataTexture(data, size, 1, THREE.RGBAFormat);
    gradient.minFilter = THREE.LinearFilter;
    gradient.magFilter = THREE.LinearFilter;
    gradient.generateMipmaps = false;
    gradient.needsUpdate = true;
  }
  return gradient;
}

/** Characters keep a little self-light at night so they stay easy to see (M7b, render/nightShading.ts). */
function toon(parameters: THREE.MeshToonMaterialParameters, away: boolean): THREE.MeshToonMaterial {
  return withCharacterLift(
    new THREE.MeshToonMaterial({
      gradientMap: gradientMap(),
      side: THREE.DoubleSide,
      ...parameters,
      ...(away ? { transparent: true, opacity: 0.45 } : {}),
    }),
  );
}

const cache = new Map<string, THREE.MeshToonMaterial>();

/** The vertex-coloured material shared by all characters. */
export function colourMaterial(away = false): THREE.MeshToonMaterial {
  const key = away ? "colour:away" : "colour";
  let material = cache.get(key);
  if (!material) {
    material = toon({ vertexColors: true }, away);
    cache.set(key, material);
  }
  return material;
}

/** Material for a patterned garment (pattern id + base colour hex). */
export function patternMaterial(pattern: string, colour: string, away = false): THREE.MeshToonMaterial {
  const key = `pattern:${pattern}:${colour}:${away ? "away" : ""}`;
  let material = cache.get(key);
  if (!material) {
    material = toon({ map: patternTexture(pattern, colour) }, away);
    cache.set(key, material);
  }
  return material;
}

/** Number of shared materials currently alive (for the performance readout). */
export const sharedMaterialCount = () => cache.size;
