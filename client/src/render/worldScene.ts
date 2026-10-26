// The 3D scene of the district (D-033). What blocks movement comes from the
// SHARED world layout; the detailed art (render/world/) is drawn inside those
// boxes, and every obstacle also gets an invisible box that taps and menus use,
// so what players see, tap and bump into always agree.
//
// Draw cost is kept low by merging: each building is one mesh (plus its signs),
// static props are four meshes, each clickable object is one mesh (so it can
// glow when selected), each tree canopy is one mesh (so it can fade).
//
// Day and night (M7b, D-037): the light, sky and haze follow the replicated
// game minute (render/world/daylight.ts). At night lit windows and lanterns
// glow through a shader uniform (no extra meshes), and two night-only meshes
// add pools of lamplight and the stars.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { WorldLayout } from "@padova/shared";
import { gradientMap } from "./avatar/materials.ts";
import { NIGHT_UNIFORMS, withNightGlow } from "./nightShading.ts";
import type { QualityProfile } from "./quality.ts";
import { cloudGeometry, nightSkyGeometry, paintSky, skyGeometry } from "./world/backdrop.ts";
import { MOON_DIRECTION, daylightAt, type DayPhase, type Daylight } from "./world/daylight.ts";
import { BUILDING_BATCH, CLOCK_FACE } from "./world/buildings.ts";
import { buildDistrict, buildInterior, fadeGroupOf, fadeVolumes } from "./world/district.ts";
import { pavingTexture, PAVING_TILE_METRES } from "./world/ground.ts";
import { P } from "./world/palette.ts";
import { SignAtlas } from "./world/signs.ts";
import type { Detail, Piece } from "./world/kit.ts";

const SELECTED_GLOW = new THREE.Color(P.terracotta);
const HOVER_GLOW = new THREE.Color("#f2b89c");
/** Opacity of a building or canopy while it hides your character. */
const FADED_OPACITY = 0.16;
/**
 * A building also fades while the camera is this close to it (metres), so a
 * camera standing beside a wall doesn't show a screen-filling façade (D-035:
 * on arrival the camera is 3 m from the shops). Buildings only; canopies
 * fade only when they hide your character.
 */
const NEAR_CAMERA_FADE_METRES = 3.5;
/** Label shown when tapping beyond the edge of the walkable area. */
const OUTSIDE_LABEL = "Beyond the piazza (not open yet)";
/** Distance of the sun (or moon) light from the middle of the square; its shadow camera looks at the middle. */
const LIGHT_DISTANCE = 50;
/** The light shown before the first game minute arrives (tools; the game always has one): the art pass's afternoon. */
const DEFAULT_MINUTE = 16 * 60;
/** Radius (metres) of the pool of light under a street lamp at night. */
const LAMP_POOL_RADIUS = 3.4;

export interface WorldStats {
  /** Time to build the geometry and meshes (ms). */
  buildMs: number;
  detail: Detail;
  meshes: number;
  triangles: number;
  materials: number;
  /** Fade groups currently see-through: they hide your character, or (buildings) the camera is very close. */
  faded: string[];
  /** The light being shown (M7b). `minute` is null until a game minute from the server has been applied. */
  daylight: { minute: number | null; phase: DayPhase; lamps: number; stars: number };
  /** An indoor room (M7c): fixed indoor light, no sky. */
  indoor: boolean;
}

export interface WorldScene {
  scene: THREE.Scene;
  /** The walkable ground (taps on it walk there). */
  ground: THREE.Mesh;
  /** Invisible boxes matching every obstacle: taps on these are refused or select the object. */
  blockers: THREE.Object3D[];
  /** Ground ring shown where the player last asked to walk. */
  targetMarker: THREE.Mesh;
  /** Invisible boxes of clickable objects, keyed by interactable id (`userData.interactableId`). */
  interactableMeshes: Map<string, THREE.Mesh>;
  /** Makes one object glow as selected and/or another as hovered (null clears). */
  highlight(selectedId: string | null, hoveredId: string | null): void;
  /** What a tap can hit right now: ground and boxes, minus faded (see-through) buildings and their overhangs. */
  pickTargets(): THREE.Object3D[];
  /** Per frame: fades what hides your character, moves the sky and the clock hands, sets the time of day's light. */
  update(camera: THREE.Camera, focus: { x: number; z: number } | null, dtSeconds: number, gameMinute: number | null): void;
  stats(): WorldStats;
  /** True once the district art is built (it is built just after the title screen shows). */
  isReady(): boolean;
  /** Resolves when the district art is built. */
  ready: Promise<void>;
}

export interface WorldSceneOptions {
  /**
   * Build the detailed art on the next turn of the event loop instead of now,
   * so the title screen appears first (the game). Tools and tests build at once.
   */
  defer?: boolean;
  /**
   * An indoor room (M7c, D-039): its floor (inside the walls) is the ground,
   * the light is a fixed indoor light, and there is no sky, haze or day/night.
   */
  interior?: { floor: { minX: number; maxX: number; minZ: number; maxZ: number } };
}

interface FadeState {
  materials: THREE.Material[];
  volumes: THREE.Box3[];
  opacity: number;
  /** Buildings also fade when the camera is very close to them. */
  building: boolean;
  /** Indoor walls (M7c): also fade while the camera is outside the room on their side (a cutaway). */
  cutaway?: (eye: THREE.Vector3) => boolean;
}

export function buildWorldScene(world: WorldLayout, quality: QualityProfile, options: WorldSceneOptions = {}): WorldScene {
  const detail: Detail = quality.name === "low" ? "low" : "high";
  const indoor = options.interior ?? null;
  const scene = new THREE.Scene();
  const background = new THREE.Color(indoor ? "#211a16" : P.skyHorizon);
  scene.background = background;
  const fog = new THREE.Fog(P.haze, 55, 150);
  scene.fog = indoor ? null : fog;

  // Soft fill from the sky and the ground, and one directional light: the sun
  // by day, the moon by night. Colours, strengths and direction follow the
  // game clock (applyLight below).
  const ambient = new THREE.HemisphereLight(0xfff1dc, 0x8a755f, 1.55);
  scene.add(ambient);
  const sun = new THREE.DirectionalLight(0xffe6c2, 2.35);
  sun.position.set(-16, 40, 15);
  if (quality.shadows) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const extent = world.halfSize + 6;
    Object.assign(sun.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent, near: 1, far: 110 });
    // Enough bias that north-facing walls (in their own shadow) don't speckle.
    sun.shadow.bias = -0.0009;
    sun.shadow.normalBias = 0.045;
  }
  scene.add(sun);

  const ramp = gradientMap();
  // Front faces only: a camera that strays inside a building sees out of it.
  const baseMaterial = withNightGlow(new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: ramp }));
  const WATER_EMISSIVE = new THREE.Color("#123c4f");
  const waterMaterial = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: ramp, transparent: true, opacity: 0.84, emissive: WATER_EMISSIVE.clone(), depthWrite: false });
  const atlas = new SignAtlas();
  const signMaterial = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: ramp, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  const materials = new Set<THREE.Material>([baseMaterial, waterMaterial, signMaterial]);

  const fades = new Map<string, FadeState>();
  const glow = new Map<string, THREE.MeshToonMaterial[]>();
  let triangles = 0;
  let meshes = 0;
  let buildMs = 0;
  let built = false;
  const minuteHands: THREE.Mesh[] = [];
  const hourHands: THREE.Mesh[] = [];

  /** Builds the detailed art (district geometry, signs, clock) and adds it to the scene. */
  const populate = () => {
    const started = performance.now();
    // ── Geometry → meshes ─────────────────────────────────────────────────────
    const district = indoor ? buildInterior(world, detail, indoor.floor) : buildDistrict(world, detail);
    const batches = new Map<string, Piece[]>();
    for (const piece of district.pieces) {
      if (piece.material === "sign" && piece.sign) mapSignUvs(piece, atlas);
      const key = `${piece.batch}|${piece.material}`;
      const list = batches.get(key) ?? [];
      list.push(piece);
      batches.set(key, list);
    }
    const signTexture = atlas.texture();
    if (signTexture) {
      signMaterial.map = signTexture;
      signMaterial.needsUpdate = true;
    }

    const volumes = fadeVolumes(world, district);
    const fadeMaterial = (group: string, base: THREE.Material): THREE.Material => {
      let state = fades.get(group);
      if (!state) {
        state = { materials: [], volumes: volumes.get(group) ?? [], opacity: 1, building: group.startsWith("building:") };
        fades.set(group, state);
      }
      const clone = base.clone();
      if (base === baseMaterial) withNightGlow(clone); // clones don't keep the shader addition
      state.materials.push(clone);
      materials.add(clone);
      return clone;
    };

    const group = new THREE.Group();
    group.name = "district";
    for (const [key, pieces] of batches) {
      const [batch, kind] = key.split("|") as [string, Piece["material"]];
      const geometry = mergeGeometries(pieces.map((p) => p.geometry), false);
      if (!geometry) throw new Error(`World batch ${batch} could not be merged`);
      for (const p of pieces) p.geometry.dispose();
      geometry.computeBoundingSphere();
      const base = kind === "water" ? waterMaterial : kind === "sign" ? signMaterial : baseMaterial;
      let material: THREE.Material = base;
      const fadeGroup = fadeGroupOf(batch);
      if (fadeGroup) material = fadeMaterial(fadeGroup, base);
      else if (batch.startsWith("interactable:") && kind === "toon") {
        const id = batch.slice("interactable:".length);
        // A room's door is cut away with its wall (M7c) but stays tappable: it is the way out.
        const doorGroup = indoor && volumes.has(`building:${id}`) ? `building:${id}` : null;
        const clone = doorGroup ? (fadeMaterial(doorGroup, baseMaterial) as THREE.MeshToonMaterial) : withNightGlow(baseMaterial.clone());
        materials.add(clone);
        glow.set(id, [...(glow.get(id) ?? []), clone]);
        material = clone;
      }
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = batch;
      const flat = batch === "ground" || batch === "backdrop";
      mesh.castShadow = quality.shadows && !flat && kind !== "water";
      mesh.receiveShadow = quality.shadows;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      group.add(mesh);
      meshes += 1;
      triangles += (geometry.index ? geometry.index.count : geometry.getAttribute("position").count) / 3;
    }
    scene.add(group);

    // Indoors, the walls on the camera's side are cut away, so the room is always seen.
    if (indoor) {
      const f = indoor.floor;
      const eps = 1e-3;
      for (const o of world.obstacles) {
        const state = fades.get(`building:${o.id}`);
        if ((o.kind !== "wall" && o.kind !== "door") || !state) continue;
        if (o.minZ >= f.maxZ - eps) state.cutaway = (eye) => eye.z > f.maxZ;
        else if (o.maxZ <= f.minZ + eps) state.cutaway = (eye) => eye.z < f.minZ;
        else if (o.minX >= f.maxX - eps) state.cutaway = (eye) => eye.x > f.maxX;
        else if (o.maxX <= f.minX + eps) state.cutaway = (eye) => eye.x < f.minX;
      }
    }

    // ── Clock hands on the hall's tower, driven by the shared game clock ──────
    if (indoor) {
      buildMs = performance.now() - started;
      built = true;
      return;
    }
    const clock = new THREE.Group();
    clock.position.set(CLOCK_FACE.x, CLOCK_FACE.y, CLOCK_FACE.z);
    const handMaterial = fades.has("building:hall") ? fadeMaterial("building:hall", baseMaterial) : baseMaterial;
    const hand = (length: number, width: number) => {
      const g = new THREE.BoxGeometry(width, length, 0.04);
      g.translate(0, length / 2 - 0.08, 0.03);
      const colours = new Float32Array(g.getAttribute("position").count * 3).fill(0.06);
      g.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));
      g.setAttribute("glow", new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute("position").count), 1));
      const mesh = new THREE.Mesh(g, handMaterial);
      clock.add(mesh);
      return mesh;
    };
    hourHands.push(hand(CLOCK_FACE.radius * 0.5, 0.11));
    minuteHands.push(hand(CLOCK_FACE.radius * 0.76, 0.07));
    scene.add(clock);
    meshes += 2;
    buildMs = performance.now() - started;
    built = true;
  };

  // ── Walkable ground (indoors: the room's wooden floor) ────────────────────
  const size = world.halfSize * 2;
  const paving = indoor ? null : pavingTexture(detail === "high" ? 512 : 256);
  if (paving) paving.repeat.set(size / PAVING_TILE_METRES, size / PAVING_TILE_METRES);
  const groundMaterial = new THREE.MeshToonMaterial({ color: paving ? 0xffffff : new THREE.Color(indoor ? "#b48356" : P.paving), map: paving, gradientMap: ramp });
  materials.add(groundMaterial);
  const floor = indoor?.floor;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(floor ? floor.maxX - floor.minX : size, floor ? floor.maxZ - floor.minZ : size), groundMaterial);
  if (floor) ground.position.set((floor.minX + floor.maxX) / 2, 0, (floor.minZ + floor.maxZ) / 2);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = quality.shadows;
  ground.name = "ground";
  scene.add(ground);
  meshes += 1;
  triangles += 2;

  // ── Sky (follows the camera, so it is never clipped by the far plane) ─────
  const sky = new THREE.Group();
  const skyMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, depthWrite: false, fog: false });
  const cloudMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, depthWrite: false, fog: false });
  materials.add(skyMaterial).add(cloudMaterial);
  const skyDome = new THREE.Mesh(skyGeometry(), skyMaterial);
  const clouds = new THREE.Mesh(mergeGeometries(cloudGeometry(), false)!, cloudMaterial);
  // Stars and the moon (drawn only at night), behind the clouds.
  // forceSinglePass: one draw call (three.js otherwise draws see-through double-sided materials twice).
  const nightSkyMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, forceSinglePass: true, transparent: true, opacity: 0, depthWrite: false, fog: false });
  materials.add(nightSkyMaterial);
  const nightSky = new THREE.Mesh(nightSkyGeometry(MOON_DIRECTION), nightSkyMaterial);
  nightSky.visible = false;
  nightSky.name = "night-sky";
  for (const [order, m] of [[-10, skyDome], [-9, nightSky], [-8, clouds]] as const) {
    m.frustumCulled = false;
    m.renderOrder = order;
    sky.add(m);
  }
  sky.scale.setScalar(170);
  sky.visible = !indoor;
  scene.add(sky);
  meshes += 3;
  triangles += nightSky.geometry.getAttribute("position").count / 3;

  // ── Pools of lamplight on the ground (drawn only at night) ────────────────
  // Additive discs, warm in the middle and fading to nothing at the edge: one
  // mesh for every lamp, no real lights (those would cost every surface).
  const poolSpots = [
    ...world.obstacles.filter((o) => o.kind === "lamp").map((o) => ({ x: (o.minX + o.maxX) / 2, z: (o.minZ + o.maxZ) / 2, radius: LAMP_POOL_RADIUS, strength: 1 })),
    ...world.obstacles.filter((o) => o.kind === "counter" || o.id === "north-west-block-porch").map((o) => ({ x: (o.minX + o.maxX) / 2, z: (o.minZ + o.maxZ) / 2, radius: 2.6, strength: 0.7 })),
  ];
  const poolMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, forceSinglePass: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  materials.add(poolMaterial);
  const pools = new THREE.Mesh(lampPoolGeometry(poolSpots), poolMaterial);
  pools.name = "lamp-pools";
  pools.visible = false;
  pools.renderOrder = 1;
  scene.add(pools);
  meshes += 1;
  triangles += (pools.geometry.index?.count ?? 0) / 3;

  // ── Time of day ───────────────────────────────────────────────────────────
  let current: Daylight = daylightAt(DEFAULT_MINUTE);
  let lightMinute: number | null = null;
  const applyLight = (d: Daylight) => {
    current = d;
    background.set(d.skyHorizon);
    fog.color.set(d.haze);
    fog.near = d.hazeNear;
    fog.far = d.hazeFar;
    ambient.color.set(d.ambientSky);
    ambient.groundColor.set(d.ambientGround);
    ambient.intensity = d.ambientIntensity;
    sun.color.set(d.lightColour);
    sun.intensity = d.lightIntensity;
    sun.position.set(d.light.x * LIGHT_DISTANCE, d.light.y * LIGHT_DISTANCE, d.light.z * LIGHT_DISTANCE);
    paintSky(skyDome.geometry, d.skyTop, d.skyMid, d.skyHorizon);
    cloudMaterial.color.set(d.clouds);
    nightSkyMaterial.opacity = d.stars;
    nightSky.visible = d.stars > 0.01 && !indoor;
    poolMaterial.opacity = d.lamps * 0.55;
    pools.visible = d.lamps > 0.01 && !indoor;
    // The fountain's water glows faintly by day; much less at night.
    waterMaterial.emissive.copy(WATER_EMISSIVE).multiplyScalar(1 - 0.75 * d.lamps);
  };
  if (indoor) {
    // A warm, even indoor light from the ceiling; the time of day doesn't reach inside (M7c).
    ambient.color.set("#fff1e0");
    ambient.groundColor.set("#6b5a4a");
    ambient.intensity = 1.5;
    sun.color.set("#fff0dc");
    sun.intensity = 1.5;
    sun.position.set(6, LIGHT_DISTANCE, 10);
    current = { ...current, lamps: 0, stars: 0, characterLift: 0 };
  } else applyLight(current);

  // ── Invisible tap and collision boxes ─────────────────────────────────────
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const hidden = new THREE.MeshBasicMaterial({ visible: false });
  const blockers: THREE.Mesh[] = [];
  const interactableMeshes = new Map<string, THREE.Mesh>();
  const interactableIds = new Set(world.interactables.map((item) => item.id));
  const proxy = (minX: number, maxX: number, minY: number, maxY: number, minZ: number, maxZ: number, name: string, label?: string) => {
    const mesh = new THREE.Mesh(unitBox, hidden);
    mesh.visible = false;
    mesh.scale.set(maxX - minX, maxY - minY, maxZ - minZ);
    mesh.position.set((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
    mesh.name = name;
    mesh.userData.label = label;
    mesh.updateMatrixWorld(true);
    scene.add(mesh);
    blockers.push(mesh);
    return mesh;
  };
  for (const obstacle of world.obstacles) {
    const mesh = proxy(obstacle.minX, obstacle.maxX, 0, obstacle.height, obstacle.minZ, obstacle.maxZ, obstacle.id, obstacle.label);
    const owner = interactableIds.has(obstacle.id) ? obstacle.id : obstacle.partOf && interactableIds.has(obstacle.partOf) ? obstacle.partOf : undefined;
    if (owner) mesh.userData.interactableId = owner;
    if (interactableIds.has(obstacle.id)) interactableMeshes.set(obstacle.id, mesh);
    // A see-through building (or inside wall, M7c) lets taps through to what is visible behind it.
    const group = obstacle.kind === "wall" ? `building:${obstacle.id}` : BUILDING_BATCH[obstacle.id];
    if (group) mesh.userData.fadeGroup = group;
  }
  // Overhangs: the portico's upper floors (not walkable ground, though over it).
  const columns = world.obstacles.filter((o) => o.kind === "arcade");
  const porticoHouse = world.obstacles.find((o) => o.id === "east-block");
  if (columns.length > 0 && porticoHouse) {
    const over = proxy(Math.min(...columns.map((c) => c.minX)), porticoHouse.minX, 4.6, 12, porticoHouse.minZ, porticoHouse.maxZ, "portico-upper-floors", porticoHouse.label);
    over.userData.fadeGroup = "building:portico";
  }
  // Beyond the edge: tapping there explains that the area isn't open yet.
  const h = world.halfSize;
  const far = 110;
  if (!indoor) {
    for (const [x0, x1, z0, z1] of [[-far, far, -far, -h], [-far, far, h, far], [-far, -h, -h, h], [h, far, -h, h]] as const) {
      proxy(x0, x1, -0.05, 0, z0, z1, "outside", OUTSIDE_LABEL);
    }
  }

  const targetMarker = new THREE.Mesh(
    new THREE.RingGeometry(0.35, 0.5, 32),
    new THREE.MeshBasicMaterial({ color: 0xc4623f, transparent: true, opacity: 0.9, depthWrite: false }),
  );
  targetMarker.rotation.x = -Math.PI / 2;
  targetMarker.position.y = 0.03;
  targetMarker.visible = false;
  scene.add(targetMarker);

  // ── Behaviour ─────────────────────────────────────────────────────────────
  const highlight = (selectedId: string | null, hoveredId: string | null) => {
    for (const [id, list] of glow) {
      const colour = id === selectedId ? SELECTED_GLOW : id === hoveredId ? HOVER_GLOW : null;
      for (const m of list) {
        if (colour) m.emissive.copy(colour);
        else m.emissive.setRGB(0, 0, 0);
        m.emissiveIntensity = id === selectedId ? 0.34 : 0.22;
      }
    }
  };

  const ray = new THREE.Ray();
  const hit = new THREE.Vector3();
  const eye = new THREE.Vector3();
  const points = [new THREE.Vector3(), new THREE.Vector3()];
  const hides = (box: THREE.Box3) => {
    if (box.containsPoint(eye)) return true;
    for (const p of points) {
      const distance = eye.distanceTo(p);
      ray.origin.copy(eye);
      ray.direction.copy(p).sub(eye).normalize();
      if (ray.intersectBox(box, hit) && eye.distanceTo(hit) < distance - 0.3 && !box.containsPoint(p)) return true;
    }
    return false;
  };
  const nearCamera = (box: THREE.Box3) => box.distanceToPoint(eye) < NEAR_CAMERA_FADE_METRES;
  const isFaded = (group: string) => (fades.get(group)?.opacity ?? 1) < 0.6;

  let hadFocus = false;
  const update = (camera: THREE.Camera, focus: { x: number; z: number } | null, dt: number, gameMinute: number | null) => {
    camera.getWorldPosition(eye);
    sky.position.copy(eye);
    if (focus) {
      points[0]!.set(focus.x, 0.9, focus.z);
      points[1]!.set(focus.x, 1.7, focus.z);
    }
    // Fade smoothly while playing, but at once on entering (no flash of a wall).
    const step = focus && !hadFocus ? 1 : 1 - Math.exp(-Math.min(dt, 0.1) * 10);
    hadFocus = focus !== null;
    for (const state of fades.values()) {
      const target = focus && (state.volumes.some(hides) || (state.building && state.volumes.some(nearCamera)) || state.cutaway?.(eye)) ? FADED_OPACITY : 1;
      if (Math.abs(state.opacity - target) < 0.002) continue;
      state.opacity += (target - state.opacity) * step;
      if (Math.abs(state.opacity - target) < 0.01) state.opacity = target;
      const transparent = state.opacity < 0.995;
      for (const m of state.materials) {
        if (m.transparent !== transparent) {
          // Still writes depth: only the nearest surface of a faded building
          // shows, instead of every wall and window frame layered on top.
          m.transparent = transparent;
          m.needsUpdate = true;
        }
        m.opacity = state.opacity;
      }
    }
    if (gameMinute !== null && !indoor) {
      // The light changes once per game minute (6 real seconds by default): too slowly to see it step.
      const whole = Math.floor(gameMinute);
      if (whole !== lightMinute) {
        lightMinute = whole;
        applyLight(daylightAt(whole));
      }
      const minutes = ((gameMinute % 1440) + 1440) % 1440;
      for (const m of minuteHands) m.rotation.z = -((minutes % 60) / 60) * Math.PI * 2;
      for (const m of hourHands) m.rotation.z = -(((minutes / 60) % 12) / 12) * Math.PI * 2;
    }
    // Shared by every material; set each frame because the character preview resets the lift.
    NIGHT_UNIFORMS.uNightGlow.value = current.lamps;
    NIGHT_UNIFORMS.uCharacterLift.value = current.characterLift;
  };

  const pickTargets = (): THREE.Object3D[] => [ground, ...blockers.filter((b) => !(b.userData.fadeGroup && isFaded(b.userData.fadeGroup as string)))];

  const ready = new Promise<void>((resolve) => {
    if (!options.defer) {
      populate();
      resolve();
      return;
    }
    // Let the page paint the title screen first, then build.
    setTimeout(() => {
      populate();
      resolve();
    }, 30);
  });

  const stats = (): WorldStats => ({
    buildMs,
    detail,
    meshes,
    triangles: Math.round(triangles),
    materials: materials.size,
    faded: [...fades].filter(([, s]) => s.opacity < 0.6).map(([name]) => name),
    daylight: { minute: lightMinute, phase: current.phase, lamps: current.lamps, stars: current.stars },
    indoor: indoor !== null,
  });

  return { scene, ground, blockers, targetMarker, interactableMeshes, highlight, pickTargets, update, stats, ready, isReady: () => built };
}

/** Warm discs on the ground (additive: black at the rim adds nothing), one per spot, as one geometry. */
function lampPoolGeometry(spots: readonly { x: number; z: number; radius: number; strength: number }[]): THREE.BufferGeometry {
  const segments = 24;
  const positions: number[] = [];
  const colours: number[] = [];
  const index: number[] = [];
  const warm = new THREE.Color("#ffb45a");
  for (const spot of spots) {
    const centre = positions.length / 3;
    positions.push(spot.x, 0.04, spot.z);
    colours.push(warm.r * spot.strength, warm.g * spot.strength, warm.b * spot.strength);
    // A middle ring keeps the falloff soft rather than a cone.
    for (const [r, fade] of [[0.45, 0.55], [1, 0]] as const) {
      for (let k = 0; k < segments; k++) {
        const a = (k / segments) * Math.PI * 2;
        positions.push(spot.x + Math.cos(a) * spot.radius * r, 0.04, spot.z + Math.sin(a) * spot.radius * r);
        colours.push(warm.r * spot.strength * fade, warm.g * spot.strength * fade, warm.b * spot.strength * fade);
      }
    }
    for (let k = 0; k < segments; k++) {
      const a = centre + 1 + k;
      const b = centre + 1 + ((k + 1) % segments);
      const c = a + segments;
      const d = b + segments;
      index.push(centre, b, a, a, b, d, a, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));
  g.setIndex(index);
  return g;
}

/** Points a sign quad's UVs at its picture in the atlas (PlaneGeometry corners: TL, TR, BL, BR). */
function mapSignUvs(piece: Piece, atlas: SignAtlas): void {
  const position = piece.geometry.getAttribute("position");
  const a = new THREE.Vector3().fromBufferAttribute(position, 0);
  const b = new THREE.Vector3().fromBufferAttribute(position, 1);
  const c = new THREE.Vector3().fromBufferAttribute(position, 2);
  const aspect = a.distanceTo(b) / Math.max(1e-3, a.distanceTo(c));
  const region = atlas.region(piece.sign!, aspect);
  const uv = piece.geometry.getAttribute("uv") as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, region.u0 + uv.getX(i) * (region.u1 - region.u0), region.v0 + uv.getY(i) * (region.v1 - region.v0));
  }
  uv.needsUpdate = true;
}
