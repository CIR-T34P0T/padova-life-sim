// A complete procedural character: builds the parts from an appearance
// config, rebuilds only the parts whose inputs changed, and poses them.
// Used by the in-world avatars, the character creator preview and the
// character lab. Presentation only: nothing here affects gameplay.

import * as THREE from "three";
import {
  DEFAULT_APPEARANCE,
  colourOf,
  skinColour,
  visibleLayers,
  type AppearanceConfig,
  type VisibleLayers,
} from "@padova/shared";
import { buildGlasses, buildHeadwear } from "./accessories.ts";
import { buildArm, buildShin, buildThigh, buildTorso, resolveOutfit, type Outfit, type Piece } from "./body.ts";
import { merge } from "./geometry.ts";
import { buildFacialHair, buildHair } from "./hair.ts";
import { buildHead } from "./head.ts";
import { colourMaterial, patternMaterial } from "./materials.ts";
import { bodyMetrics, type BodyMetrics } from "./metrics.ts";

type PartName = "head" | "torso" | "armL" | "armR" | "thighL" | "thighR" | "shinL" | "shinR";

/** Seated activities with both hands on the desk (no per-frame allocation in the pose code). */
const DESK_BUSY: ReadonlySet<string> = new Set(["studying", "sketching", "attending", "exam"]);
/** Height of a sleeping character's back above the floor: the top of a bed's mattress (M10). */
const LYING_HEIGHT = 0.7;
const PARTS: readonly PartName[] = ["head", "torso", "armL", "armR", "thighL", "thighR", "shinL", "shinR"];

export interface PoseInput {
  moving: boolean;
  seated: boolean;
  activity: string;
  /** Seconds, for animation. */
  time: number;
}

export interface CharacterStats {
  triangles: number;
  meshes: number;
  /** Milliseconds spent in the last (re)build, and which parts were rebuilt. */
  buildMs: number;
  rebuilt: PartName[];
  /**
   * Parts that could not be built from this look and were drawn from the
   * default look instead (a renderer bug or an option without renderer code).
   * Empty normally; the creator tells the player when it isn't.
   */
  fallback: PartName[];
}

interface PartState {
  group: THREE.Group;
  meshes: THREE.Mesh[];
  signature: string;
}

/** The inputs each part depends on, so a change rebuilds only what it affects. */
function signatures(config: AppearanceConfig, layers: VisibleLayers): Record<PartName, string> {
  const { body, skin, face, hair, outfit } = config;
  const clothes = { ...outfit, glasses: undefined, headwear: undefined, headwearColour: undefined };
  const head = JSON.stringify([body, skin, face, hair, outfit.headwear, outfit.headwearColour, outfit.glasses, layers.hair]);
  const torso = JSON.stringify([body, skin.tone, skin.undertone, clothes, layers.topAndBottom]);
  const arm = JSON.stringify([body, skin.tone, skin.undertone, outfit.top, outfit.topColour, outfit.full, outfit.pattern, outfit.outer, outfit.outerColour]);
  const thigh = JSON.stringify([body, skin.tone, skin.undertone, outfit.bottom, outfit.bottomColour, outfit.full, outfit.topColour, outfit.pattern, outfit.outer, outfit.outerColour]);
  const shin = JSON.stringify([thigh, outfit.shoes, outfit.shoesColour]);
  return { head, torso, armL: arm, armR: arm, thighL: thigh, thighR: thigh, shinL: shin, shinR: shin };
}

interface BuildContext {
  metrics: BodyMetrics;
  skin: string;
  hairHex: string;
  outfit: Outfit;
  layers: VisibleLayers;
}

function buildPart(name: PartName, config: AppearanceConfig, ctx: BuildContext): Piece[] {
  const { metrics, skin, hairHex, outfit, layers } = ctx;
  switch (name) {
    case "head": {
      const built = buildHead(config, metrics, skin, hairHex);
      const hair = buildHair(config, built.head, built.layout, metrics, hairHex, skin, layers.hair);
      const geometry = [
        ...built.pieces,
        ...hair.pieces,
        ...buildFacialHair(config, built.head, hairHex),
        ...buildHeadwear(config, built.head, metrics, hair.thicknessAt, colourOf("clothingColours", config.outfit.headwearColour, "#d4a12e"), layers.hair),
        ...buildGlasses(config, built.head, built.layout),
      ];
      return geometry.map((g) => ({ geometry: g, material: "colour" as const, pose: "always" as const }));
    }
    case "torso":
      return buildTorso(metrics, outfit);
    case "armL":
      return buildArm(metrics, outfit, 1);
    case "armR":
      return buildArm(metrics, outfit, -1);
    case "thighL":
    case "thighR":
      return buildThigh(metrics, outfit);
    case "shinL":
    case "shinR":
      return buildShin(metrics, outfit, config);
  }
}

/** The default look's version of a part; empty if even that fails. */
function safeDefaultPart(name: PartName): Piece[] {
  try {
    const config = DEFAULT_APPEARANCE;
    const layers = visibleLayers(config);
    const metrics = bodyMetrics(config);
    const skin = skinColour(config.skin.tone, config.skin.undertone);
    const outfit = resolveOutfit(config, layers, skin, (id) => colourOf("clothingColours", id, "#888888"), metrics);
    return buildPart(name, config, { metrics, skin, hairHex: colourOf("hairColours", config.hair.colour, "#3b2a22"), outfit, layers });
  } catch (error) {
    console.error(`Could not build the default ${name} either`, error);
    return [];
  }
}

export class CharacterModel {
  readonly root = new THREE.Group();
  /** Lowered and shifted when seated. */
  readonly figure = new THREE.Group();
  private readonly torsoPivot = new THREE.Group();
  private readonly headPivot = new THREE.Group();
  private readonly shoulders = { L: new THREE.Group(), R: new THREE.Group() };
  private readonly hips = { L: new THREE.Group(), R: new THREE.Group() };
  private readonly knees = { L: new THREE.Group(), R: new THREE.Group() };
  private readonly parts = new Map<PartName, PartState>();
  private config: AppearanceConfig | null = null;
  private metricsValue: BodyMetrics | null = null;
  private outfit: Outfit | null = null;
  private away = false;
  private seated = false;
  stats: CharacterStats = { triangles: 0, meshes: 0, buildMs: 0, rebuilt: [], fallback: [] };

  constructor(
    config: AppearanceConfig,
    private readonly options: { shadows: boolean } = { shadows: false },
  ) {
    this.root.add(this.figure);
    this.figure.add(this.torsoPivot);
    this.torsoPivot.add(this.headPivot, this.shoulders.L, this.shoulders.R);
    this.figure.add(this.hips.L, this.hips.R);
    this.hips.L.add(this.knees.L);
    this.hips.R.add(this.knees.R);
    const groups: Record<PartName, THREE.Group> = {
      head: this.headPivot,
      torso: this.torsoPivot,
      armL: this.shoulders.L,
      armR: this.shoulders.R,
      thighL: this.hips.L,
      thighR: this.hips.R,
      shinL: this.knees.L,
      shinR: this.knees.R,
    };
    for (const name of PARTS) this.parts.set(name, { group: groups[name], meshes: [], signature: "" });
    this.setAppearance(config);
  }

  get metrics(): BodyMetrics {
    return this.metricsValue!;
  }

  get appearance(): AppearanceConfig | null {
    return this.config;
  }

  /** Applies a look, rebuilding only the parts whose inputs changed. */
  setAppearance(config: AppearanceConfig): CharacterStats {
    const started = performance.now();
    const layers = visibleLayers(config);
    const metrics = bodyMetrics(config);
    const skin = skinColour(config.skin.tone, config.skin.undertone);
    const hairHex = colourOf("hairColours", config.hair.colour, "#3b2a22");
    const outfit = resolveOutfit(config, layers, skin, (id) => colourOf("clothingColours", id, "#888888"), metrics);
    this.config = config;
    this.metricsValue = metrics;
    this.outfit = outfit;
    this.placePivots(metrics);

    const next = signatures(config, layers);
    const rebuilt: PartName[] = [];
    const fallback: PartName[] = [];
    for (const name of PARTS) {
      const part = this.parts.get(name)!;
      if (part.signature === next[name]) continue;
      let pieces: Piece[];
      let materialConfig = config;
      try {
        pieces = buildPart(name, config, { metrics, skin, hairHex, outfit, layers });
      } catch (error) {
        // Fail safe: draw this part from the default look rather than leaving
        // a hole or breaking the whole character (and every other player's view).
        console.error(`Could not build the ${name} of this look; drawing the default instead`, error);
        materialConfig = DEFAULT_APPEARANCE;
        pieces = safeDefaultPart(name);
        fallback.push(name);
      }
      this.replaceMeshes(part, pieces, materialConfig);
      // A failed part keeps an impossible signature, so the next change tries again.
      part.signature = fallback.includes(name) ? `fallback:${next[name]}` : next[name];
      rebuilt.push(name);
    }
    this.applyPoseVisibility();
    const stillFallback = PARTS.filter((name) => this.parts.get(name)!.signature.startsWith("fallback:"));
    this.stats = { ...this.countStats(), buildMs: performance.now() - started, rebuilt, fallback: stillFallback };
    return this.stats;
  }

  private placePivots(m: BodyMetrics): void {
    this.headPivot.position.set(0, m.headCentreY, 0);
    this.shoulders.L.position.set(m.shoulderJointX, m.shoulderJointY, 0);
    this.shoulders.R.position.set(-m.shoulderJointX, m.shoulderJointY, 0);
    this.hips.L.position.set(m.legOffsetX, m.hipY, 0);
    this.hips.R.position.set(-m.legOffsetX, m.hipY, 0);
    this.knees.L.position.set(0, -(m.hipY - m.kneeY), 0);
    this.knees.R.position.set(0, -(m.hipY - m.kneeY), 0);
  }

  private replaceMeshes(part: PartState, pieces: Piece[], config: AppearanceConfig): void {
    for (const mesh of part.meshes) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
    }
    part.meshes = [];
    const groups = new Map<string, THREE.BufferGeometry[]>();
    for (const piece of pieces) {
      const key = `${piece.material}|${piece.pose}`;
      const list = groups.get(key) ?? [];
      list.push(piece.geometry);
      groups.set(key, list);
    }
    for (const [key, list] of groups) {
      const [material, pose] = key.split("|") as [Piece["material"], Piece["pose"]];
      const mesh = new THREE.Mesh(merge(list), this.materialFor(material, config));
      mesh.userData.pose = pose;
      mesh.userData.materialKind = material;
      mesh.castShadow = this.options.shadows;
      mesh.receiveShadow = false;
      part.group.add(mesh);
      part.meshes.push(mesh);
    }
  }

  private materialFor(kind: Piece["material"], config: AppearanceConfig): THREE.Material {
    if (kind === "pattern") {
      return patternMaterial(config.outfit.pattern, colourOf("clothingColours", config.outfit.topColour, "#888888"), this.away);
    }
    return colourMaterial(this.away);
  }

  setAway(away: boolean): void {
    if (this.away === away) return;
    this.away = away;
    for (const part of this.parts.values()) {
      for (const mesh of part.meshes) mesh.material = this.materialFor(mesh.userData.materialKind as Piece["material"], this.config!);
    }
  }

  private applyPoseVisibility(): void {
    for (const part of this.parts.values()) {
      for (const mesh of part.meshes) {
        const pose = mesh.userData.pose as Piece["pose"];
        mesh.visible = pose === "always" || (pose === "seated") === this.seated;
      }
    }
  }

  private countStats(): { triangles: number; meshes: number } {
    let triangles = 0;
    let meshes = 0;
    for (const part of this.parts.values()) {
      for (const mesh of part.meshes) {
        if (!mesh.visible) continue;
        meshes++;
        triangles += (mesh.geometry.index?.count ?? mesh.geometry.getAttribute("position").count) / 3;
      }
    }
    return { triangles, meshes };
  }

  /** Total height (m), for placing name tags and menus. */
  get height(): number {
    return this.metricsValue?.height ?? 1.7;
  }

  /** Poses the parts. Cheap: only rotations and offsets, no geometry changes. */
  pose(input: PoseInput): void {
    const m = this.metricsValue!;
    const stride = this.outfit?.stride ?? 1;
    // Asleep in a bed (M10): lying on the back along the bed, legs straight
    // (so skirts and coats keep their standing shape).
    const lying = input.seated && input.activity === "sleeping";
    const seatedShape = input.seated && !lying;
    if (seatedShape !== this.seated) {
      this.seated = seatedShape;
      this.applyPoseVisibility();
      this.stats = { ...this.stats, ...this.countStats() };
    }
    const t = input.time;
    const rest = m.armRestAngle;
    let thighL = 0;
    let thighR = 0;
    let shinL = 0;
    let shinR = 0;
    let armLX = 0;
    let armRX = 0;
    let armLZ = rest;
    let armRZ = -rest;
    let figureY = 0;
    let figureZ = 0;
    let breathe = 1 + Math.sin(t * 1.6) * 0.004;
    let figureTilt = 0;

    if (lying) {
      // The root stands at the foot of the bed facing from head to feet: tip
      // the figure back so the head points along the bed, face up, on the mattress.
      figureTilt = -Math.PI / 2;
      figureY = LYING_HEIGHT;
      armLZ = rest * 0.35;
      armRZ = -rest * 0.35;
      breathe = 1 + Math.sin(t * 0.9) * 0.012;
    } else if (input.seated) {
      const seatTop = 0.5;
      const hipHeight = seatTop + m.thighRadius * 0.85;
      figureY = hipHeight - m.hipY;
      figureZ = -0.1;
      thighL = thighR = -Math.PI / 2;
      const shinLength = m.kneeY;
      const tilt = shinLength > hipHeight ? Math.acos(Math.min(1, hipHeight / shinLength)) : 0;
      shinL = shinR = Math.PI / 2 - tilt;
      // Hands on the desk while studying, sketching, in a lecture or an exam (M8).
      const busy = DESK_BUSY.has(input.activity);
      armLX = armRX = busy ? -0.95 + Math.sin(t * 3) * 0.04 : -0.5;
      armLZ = rest * 0.4;
      armRZ = -rest * 0.4;
      if (input.activity === "sketching") armRX = -1.05 + Math.sin(t * 7) * 0.08;
      // Writing answers in the exam: a slower pen than sketching.
      if (input.activity === "exam") armRX = -1.0 + Math.sin(t * 4.5) * 0.06;
      breathe = 1;
    } else if (input.moving) {
      const phase = t * 8.5;
      const swing = 0.42 * stride;
      thighL = -Math.sin(phase) * swing;
      thighR = Math.sin(phase) * swing;
      shinL = Math.max(0, Math.sin(phase - 1.1)) * 0.7 * stride;
      shinR = Math.max(0, -Math.sin(phase - 1.1)) * 0.7 * stride;
      armLX = Math.sin(phase) * 0.36 * stride;
      armRX = -Math.sin(phase) * 0.36 * stride;
      figureY = Math.abs(Math.sin(phase)) * 0.022;
      breathe = 1;
    } else {
      switch (input.activity) {
        case "greeting":
          armRZ = -(2.55 + Math.sin(t * 9) * 0.22);
          break;
        case "chatting":
          // Talking with the hands (M9): one forearm raised, moving gently.
          armRX = -0.9 + Math.sin(t * 3.1) * 0.25;
          armRZ = -0.15;
          armLX = -0.25 + Math.sin(t * 2.3 + 1) * 0.08;
          break;
        case "ordering":
          armRX = -0.55;
          break;
        case "eating":
        case "drinking":
          armRX = -1.85 + Math.sin(t * 2.2) * 0.18;
          armRZ = -0.25;
          break;
        case "washing":
          armLX = armRX = -0.85 + Math.sin(t * 4) * 0.08;
          armLZ = 0.18;
          armRZ = -0.18;
          break;
        case "working":
          // Serving behind the counter: both hands busy at counter height, in turn.
          armLX = -0.75 + Math.sin(t * 2.6) * 0.16;
          armRX = -0.75 - Math.sin(t * 2.6) * 0.16;
          armLZ = 0.12;
          armRZ = -0.12;
          break;
        default:
          armLX = Math.sin(t * 0.9) * 0.025;
          armRX = Math.sin(t * 0.9 + 1) * 0.025;
      }
    }
    this.figure.position.set(0, figureY, figureZ);
    this.figure.rotation.set(figureTilt, 0, 0);
    this.torsoPivot.scale.set(1, breathe, 1);
    this.hips.L.rotation.set(thighL, 0, 0);
    this.hips.R.rotation.set(thighR, 0, 0);
    this.knees.L.rotation.set(shinL, 0, 0);
    this.knees.R.rotation.set(shinR, 0, 0);
    this.shoulders.L.rotation.set(armLX, 0, armLZ);
    this.shoulders.R.rotation.set(armRX, 0, armRZ);
  }

  dispose(): void {
    for (const part of this.parts.values()) {
      for (const mesh of part.meshes) mesh.geometry.dispose();
      part.meshes = [];
    }
    this.root.removeFromParent();
  }
}
