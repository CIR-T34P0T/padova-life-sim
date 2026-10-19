// Character lab (developer page, client/lab.html): renders presets and
// option sweeps side by side with their build cost, for visual checks and
// automated screenshots. Not linked from the game.

import * as THREE from "three";
import {
  APPEARANCE_PRESETS,
  BOTTOMS,
  DEFAULT_APPEARANCE,
  EYE_SHAPES,
  FACE_SHAPES,
  FACIAL_HAIR,
  FULL_OUTFITS,
  GLASSES,
  HAIRLINES,
  HAIR_STYLES,
  HEADWEAR,
  LIP_SHAPES,
  NOSE_SHAPES,
  OUTERWEAR,
  PATTERNS,
  SHOES,
  SKIN_TONE_STOPS,
  TOPS,
  BROW_SHAPES,
  BUILDS,
  cloneAppearance,
  fromLookCode,
  randomAppearance,
  type AppearanceConfig,
} from "@padova/shared";
import { CharacterModel, sharedMaterialCount, type PoseInput } from "./render/avatar/index.ts";

interface Cell {
  label: string;
  note?: string;
  config: AppearanceConfig;
  view: "body" | "face" | "upper";
  pose?: Partial<PoseInput>;
  yaw?: number;
}

const params = new URLSearchParams(location.search);
const view = (params.get("view") as Cell["view"]) ?? "body";
const yaw = Number(params.get("yaw") ?? "0.35");

const base = (id = "lavender-ponytail") => cloneAppearance(APPEARANCE_PRESETS.find((p) => p.id === id)?.appearance ?? DEFAULT_APPEARANCE);
const variant = (from: AppearanceConfig, change: (c: AppearanceConfig) => void) => {
  const c = cloneAppearance(from);
  change(c);
  return c;
};

function cellsFor(): Cell[] {
  const options = params.get("options");
  const look = params.get("look");
  if (look) {
    const config = fromLookCode(look);
    return config ? [{ label: "Look code", config, view }] : [];
  }
  if (params.has("random")) {
    return Array.from({ length: 24 }, (_, i) => ({ label: `Random ${i + 1}`, config: randomAppearance(1000 + i), view }));
  }
  switch (options) {
    case "hair": {
      const bases = [base("lavender-ponytail"), variant(base("cornrows"), (c) => (c.hair.facial = "none"))];
      const cells: Cell[] = [];
      for (const style of HAIR_STYLES) {
        cells.push({ label: style.label, note: style.texture, config: variant(bases[0]!, (c) => (c.hair.style = style.id)), view: params.get("view") ? view : "upper", yaw: 0.6 });
      }
      for (const style of HAIR_STYLES) {
        cells.push({ label: `${style.label} (back)`, config: variant(bases[1]!, (c) => (c.hair.style = style.id)), view: params.get("view") ? view : "upper", yaw: Math.PI - 0.5 });
      }
      for (const hairline of HAIRLINES) cells.push({ label: `Hairline: ${hairline.label}`, config: variant(bases[0]!, (c) => ((c.hair.style = "fade-crop"), (c.hair.hairline = hairline.id))), view: "face" });
      for (const facial of FACIAL_HAIR) cells.push({ label: `Facial hair: ${facial.label}`, config: variant(bases[1]!, (c) => (c.hair.facial = facial.id)), view: "face" });
      return cells;
    }
    case "outfit": {
      const b = base("lavender-ponytail");
      const cells: Cell[] = [];
      const plain = variant(b, (c) => (c.outfit.pattern = "plain"));
      for (const top of TOPS) cells.push({ label: `Top: ${top.label}`, config: variant(plain, (c) => (c.outfit.top = top.id)), view: "upper" });
      for (const bottom of BOTTOMS) cells.push({ label: `Bottom: ${bottom.label}`, config: variant(plain, (c) => (c.outfit.bottom = bottom.id)), view: "body" });
      for (const full of FULL_OUTFITS.slice(1)) cells.push({ label: `Full: ${full.label}`, config: variant(plain, (c) => (c.outfit.full = full.id)), view: "body" });
      for (const pattern of PATTERNS) cells.push({ label: `Pattern: ${pattern.label}`, config: variant(b, (c) => ((c.outfit.pattern = pattern.id), (c.outfit.top = "shirt"))), view: "upper" });
      for (const outer of OUTERWEAR.slice(1)) cells.push({ label: `Outer: ${outer.label}`, config: variant(plain, (c) => (c.outfit.outer = outer.id)), view: "body" });
      for (const shoes of SHOES) cells.push({ label: `Shoes: ${shoes.label}`, config: variant(plain, (c) => ((c.outfit.shoes = shoes.id), (c.outfit.bottom = "shorts"))), view: "body" });
      for (const headwear of HEADWEAR.slice(1)) cells.push({ label: `Head: ${headwear.label}`, config: variant(plain, (c) => (c.outfit.headwear = headwear.id)), view: "upper", yaw: 0.5 });
      for (const glasses of GLASSES.slice(1)) cells.push({ label: `Glasses: ${glasses.label}`, config: variant(plain, (c) => (c.outfit.glasses = glasses.id)), view: "face" });
      return cells;
    }
    case "skin": {
      const cells: Cell[] = [];
      for (const stop of SKIN_TONE_STOPS) cells.push({ label: stop.label, config: variant(base("bob-glasses"), (c) => (c.skin.tone = stop.at)), view: "face" });
      for (const undertone of ["cool", "neutral", "warm"] as const) {
        for (const tone of [0.1, 0.5, 0.9]) cells.push({ label: `${undertone} ${tone}`, config: variant(base("bob-glasses"), (c) => ((c.skin.tone = tone), (c.skin.undertone = undertone))), view: "face" });
      }
      for (const freckles of ["light", "many"] as const) cells.push({ label: `Freckles: ${freckles}`, config: variant(base("bob-glasses"), (c) => (c.skin.freckles = freckles)), view: "face" });
      for (const build of BUILDS) {
        for (const frame of ["feminine", "masculine"] as const) cells.push({ label: `${frame} ${build.label}`, config: variant(base("bob-glasses"), (c) => ((c.body.build = build.id), (c.body.frame = frame))), view: "body" });
      }
      for (const [field, value] of [["height", 0], ["height", 1], ["shoulders", 0], ["shoulders", 1], ["legs", 0], ["legs", 1], ["torso", 0], ["torso", 1], ["arms", 0], ["arms", 1]] as const) {
        cells.push({ label: `${field} ${value}`, config: variant(base("bob-glasses"), (c) => (c.body[field] = value)), view: "body" });
      }
      return cells;
    }
    case "face": {
      const b = base("bob-glasses");
      b.outfit.glasses = "none";
      b.hair.style = "buzz"; // keep the face outline visible
      const cells: Cell[] = [];
      for (const shape of FACE_SHAPES) cells.push({ label: `Face: ${shape.label}`, config: variant(b, (c) => (c.face.shape = shape.id)), view: "face" });
      for (const eye of EYE_SHAPES) cells.push({ label: `Eyes: ${eye.label}`, config: variant(b, (c) => (c.face.eyeShape = eye.id)), view: "face" });
      for (const nose of NOSE_SHAPES) cells.push({ label: `Nose: ${nose.label}`, config: variant(b, (c) => (c.face.noseShape = nose.id)), view: "face", yaw: 0.9 });
      for (const lips of LIP_SHAPES) cells.push({ label: `Lips: ${lips.label}`, config: variant(b, (c) => (c.face.lipShape = lips.id)), view: "face" });
      for (const brow of BROW_SHAPES) cells.push({ label: `Brows: ${brow.label}`, config: variant(b, (c) => (c.face.browShape = brow.id)), view: "face" });
      for (const field of ["cheekbones", "jaw", "chin", "forehead", "eyeSize", "eyeSpacing", "browHeight", "noseWidth", "noseLength", "lipFullness"] as const) {
        for (const value of [0, 1]) cells.push({ label: `${field} ${value}`, config: variant(b, (c) => (c.face[field] = value)), view: "face" });
      }
      return cells;
    }
    case "pose": {
      const cells: Cell[] = [];
      for (const preset of APPEARANCE_PRESETS.slice(0, 6)) {
        cells.push({ label: `${preset.label}: walk`, config: preset.appearance, view: "body", pose: { moving: true, time: 0.2 }, yaw: 1.2 });
        cells.push({ label: `${preset.label}: seated`, config: preset.appearance, view: "body", pose: { seated: true, activity: "sitting" }, yaw: 1.2 });
        cells.push({ label: `${preset.label}: greeting`, config: preset.appearance, view: "body", pose: { activity: "greeting", time: 0.3 } });
      }
      return cells;
    }
    default:
      return APPEARANCE_PRESETS.map((preset) => ({ label: preset.label, config: preset.appearance, view }));
  }
}

const grid = document.getElementById("grid")!;
const canvas = document.getElementById("stage") as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setScissorTest(true);
const scene = new THREE.Scene();
const hemi = new THREE.HemisphereLight(0xfff4e0, 0x7a6a58, 1.6);
const sun = new THREE.DirectionalLight(0xfff0d8, 2.2);
sun.position.set(2.5, 4, 3.5);
scene.add(hemi, sun);
const floor = new THREE.Mesh(new THREE.CircleGeometry(0.45, 32), new THREE.MeshBasicMaterial({ color: 0xd8cbb8 }));
floor.rotation.x = -Math.PI / 2;
scene.add(floor);
const camera = new THREE.PerspectiveCamera(28, 1, 0.05, 50);

const cells = cellsFor();
if (cells.length === 1) document.documentElement.style.setProperty("--cell", "520px");
if (view === "face") document.documentElement.style.setProperty("--ratio", "1");
const built: { cell: Cell; model: CharacterModel; element: HTMLElement }[] = [];
const errors: string[] = [];
let totalMs = 0;
for (const cell of cells) {
  const element = document.createElement("div");
  element.className = "cell";
  const viewBox = document.createElement("div");
  viewBox.className = "view";
  if (cell.view === "face") viewBox.style.aspectRatio = "1";
  const label = document.createElement("div");
  label.className = "label";
  try {
    const model = new CharacterModel(cell.config);
    model.pose({ moving: false, seated: false, activity: "idle", time: 0, ...cell.pose });
    totalMs += model.stats.buildMs;
    label.innerHTML = `<b></b><small></small>`;
    label.querySelector("b")!.textContent = cell.label;
    label.querySelector("small")!.textContent = `${Math.round(model.stats.triangles / 100) / 10}k tris · ${model.stats.meshes} meshes · ${model.stats.buildMs.toFixed(1)} ms${cell.note ? ` · ${cell.note}` : ""}`;
    model.root.visible = false;
    scene.add(model.root);
    built.push({ cell, model, element: viewBox });
  } catch (error) {
    errors.push(`${cell.label}: ${(error as Error).message}`);
    label.textContent = `${cell.label}: FAILED ${(error as Error).message}`;
  }
  element.append(viewBox, label);
  grid.append(element);
}

function frame(model: CharacterModel, cellView: Cell["view"], aspect: number, cellYaw: number) {
  const m = model.metrics;
  const target =
    cellView === "face"
      ? new THREE.Vector3(0, m.headCentreY - 0.005, 0)
      : cellView === "upper"
        ? new THREE.Vector3(0, m.headCentreY - 0.17, 0)
        : new THREE.Vector3(0, m.height * 0.5, 0);
  const span = cellView === "face" ? 0.36 : cellView === "upper" ? 0.75 : m.height + 0.2;
  camera.aspect = aspect;
  camera.fov = 28;
  camera.updateProjectionMatrix();
  const fov = THREE.MathUtils.degToRad(camera.fov);
  // Fit the height; the figure is narrower than the cell.
  const distance = span / 2 / Math.tan(fov / 2) / Math.min(1, aspect / 0.55);
  camera.position.set(Math.sin(cellYaw) * distance, target.y + (cellView === "body" ? 0.12 : 0.03), Math.cos(cellYaw) * distance);
  camera.lookAt(target);
}

function render() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.setSize(width, height, false);
  renderer.setScissor(0, 0, width, height);
  renderer.setViewport(0, 0, width, height);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  for (const { cell, model, element } of built) {
    const rect = element.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > height) continue;
    const bottom = height - rect.bottom;
    renderer.setViewport(rect.left, bottom, rect.width, rect.height);
    renderer.setScissor(rect.left, bottom, rect.width, rect.height);
    renderer.setClearColor(0xf4eee6, 1);
    renderer.clear();
    model.root.visible = true;
    frame(model, cell.view, rect.width / rect.height, cell.yaw ?? yaw);
    renderer.render(scene, camera);
    model.root.visible = false;
  }
}
render();
window.addEventListener("resize", render);
window.addEventListener("scroll", render, { passive: true });

const summary = `${built.length} characters · build ${totalMs.toFixed(0)} ms total (${(totalMs / Math.max(1, built.length)).toFixed(1)} ms avg) · ${sharedMaterialCount()} shared materials${errors.length ? ` · ${errors.length} FAILED` : ""}`;
document.getElementById("summary")!.textContent = summary;
(window as unknown as { __lab: unknown }).__lab = {
  ready: true,
  errors,
  summary,
  cells: built.map(({ cell, model }) => ({ label: cell.label, ...model.stats })),
  render,
};
