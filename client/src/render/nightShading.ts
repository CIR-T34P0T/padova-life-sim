// Night shading (M7b, D-037): two small additions to the toon shader, driven
// by uniforms shared by every material, so the whole district changes with
// one assignment and no extra draw calls or materials.
//
// - Glow (world materials): geometry marks lit windows, lanterns and lamp
//   heads with a per-vertex `glow` strength (render/world/kit.ts `glowing`);
//   at night they shine with a warm light, by day they look as before.
// - Lift (character materials): characters add a fraction of their own colour
//   as self-light, so they stay as easy to see at night as by day.
//
// The world scene sets the values from the day/night rule every frame it
// draws; the character preview (creator) sets the lift back to 0 before it
// draws, so its studio light is never affected.

import * as THREE from "three";

export const NIGHT_UNIFORMS = {
  /** 0–1: how much lit windows and lamps shine. */
  uNightGlow: { value: 0 },
  /** Colour of the glow (linear), a warm lamplight. */
  uGlowColour: { value: new THREE.Color("#ffb85c") },
  /** 0–1: self-light added to characters, as a fraction of their colour. */
  uCharacterLift: { value: 0 },
};

/**
 * Lets a world material glow where its geometry has a `glow` attribute.
 * Every mesh drawn with it must carry the attribute (zeros where nothing
 * glows). Call again after `clone()`: clones don't keep `onBeforeCompile`.
 */
export function withNightGlow<T extends THREE.Material>(material: T): T {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uNightGlow = NIGHT_UNIFORMS.uNightGlow;
    shader.uniforms.uGlowColour = NIGHT_UNIFORMS.uGlowColour;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float glow;\nvarying float vGlow;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvGlow = glow;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uNightGlow;\nuniform vec3 uGlowColour;\nvarying float vGlow;")
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += uGlowColour * (vGlow * uNightGlow);");
  };
  material.customProgramCacheKey = () => "night-glow";
  return material;
}

/** Lets a character material add a little of its own colour as light at night. */
export function withCharacterLift<T extends THREE.Material>(material: T): T {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uCharacterLift = NIGHT_UNIFORMS.uCharacterLift;
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uCharacterLift;")
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * uCharacterLift;");
  };
  material.customProgramCacheKey = () => "character-lift";
  return material;
}
