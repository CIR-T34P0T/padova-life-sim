// World lab (developer page, client/world-lab.html): the district without a
// server, from preset viewpoints, with the collision boxes overlaid on demand
// and the draw cost on screen. Used for visual checks and screenshots. Not
// linked from the game.
//
//   ?view=overview|game|hall|porch|library|portico|cafe|market|fountain|street|south|skyline
//   ?collision      show every collision box as a wireframe (orange = clickable)
//   ?quality=low    phone detail level
//   ?people         a few characters for scale (on a bench, at a café table, walking)

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { APPEARANCE_PRESETS, PLAZA_LAYOUT, findSeat } from "@padova/shared";
import { CharacterModel } from "./render/avatar/index.ts";
import { buildWorldScene } from "./render/worldScene.ts";

const params = new URLSearchParams(location.search);
const low = params.get("quality") === "low";
const quality = low
  ? { name: "low" as const, maxPixelRatio: 1.5, shadows: false, antialias: false }
  : { name: "high" as const, maxPixelRatio: 2, shadows: true, antialias: true };

const canvas = document.getElementById("stage") as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: quality.antialias, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality.maxPixelRatio));
renderer.shadowMap.enabled = quality.shadows;
const world = buildWorldScene(PLAZA_LAYOUT, quality);
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;

/** Viewpoints: camera position and the point it looks at. */
const VIEWS: Record<string, [THREE.Vector3Tuple, THREE.Vector3Tuple]> = {
  overview: [[30, 42, 46], [0, 0, -2]],
  game: [[0, 7.6, 21.9], [0, 1.1, 13]],
  hall: [[-6, 9, -2], [-13, 6, -20]],
  porch: [[-13, 4.2, -10.5], [-13, 2.6, -19.5]],
  library: [[8, 9, -4], [14, 6, -20]],
  portico: [[9, 5, -6], [18.2, 2.6, 2]],
  cafe: [[5, 6, 16.5], [12, 1, 10]],
  market: [[-3, 6.5, 16], [-3.5, 1, 7]],
  fountain: [[5, 5.5, 6], [0, 1, -3]],
  street: [[0.5, 6, -9], [0.5, 4, -36]],
  south: [[0, 9, -4], [0, 4, 22]],
  skyline: [[0, 26, 30], [0, 18, -60]],
};
const viewName = params.get("view") ?? "overview";
const [eye, target] = VIEWS[viewName] ?? VIEWS.overview!;
camera.position.set(...eye);
controls.target.set(...target);

if (params.has("collision")) {
  const clickable = new THREE.MeshBasicMaterial({ color: 0xff7a1a, wireframe: true });
  const solid = new THREE.MeshBasicMaterial({ color: 0xd61f3c, wireframe: true });
  for (const proxy of world.blockers) {
    if (proxy.name === "outside") continue;
    proxy.visible = true;
    (proxy as THREE.Mesh).material = proxy.userData.interactableId ? clickable : solid;
  }
}

if (params.has("people")) {
  const place = (presetIndex: number, x: number, z: number, rotation: number, seated: boolean, activity = "idle", moving = false) => {
    const model = new CharacterModel(APPEARANCE_PRESETS[presetIndex % APPEARANCE_PRESETS.length]!.appearance);
    model.pose({ moving, seated, activity, time: 0.4 });
    model.root.position.set(x, 0, z);
    model.root.rotation.y = rotation;
    world.scene.add(model.root);
  };
  const seat = (id: string, preset: number, activity = "sitting") => {
    const found = findSeat(PLAZA_LAYOUT, id)!.seat;
    place(preset, found.x, found.z, found.rotation, true, activity);
  };
  seat("bench-1/seat-a", 1);
  seat("bench-1/seat-b", 4, "sketching");
  seat("cafe-table-1/seat-a", 6);
  seat("cafe-table-1/seat-b", 9);
  seat("desk-2/seat-a", 2, "studying");
  seat("bench-5/seat-a", 12);
  place(3, 1.5, 12.5, Math.PI, false, "idle", true);
  place(7, -12.8, -18.8, 0, false);
  place(10, 18.4, -2, Math.PI, false, "idle", true);
  place(5, 8.25, 8.95, 0, false, "ordering");
}

const stats = document.getElementById("stats")!;
function resize(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

let last = performance.now();
let updateMs = 0;
let renderMs = 0;
let intervalMs = 16.7;
let frames = 0;
renderer.setAnimationLoop(() => {
  const now = performance.now();
  const dt = (now - last) / 1000;
  last = now;
  controls.update();
  const t0 = performance.now();
  world.update(camera, null, dt, 10 * 60 + 10);
  const t1 = performance.now();
  renderer.render(world.scene, camera);
  const t2 = performance.now();
  // Rolling averages after the first frames (shader compilation) are over.
  if (++frames > 10) {
    updateMs += (t1 - t0 - updateMs) * 0.1;
    renderMs += (t2 - t1 - renderMs) * 0.1;
    intervalMs += (dt * 1000 - intervalMs) * 0.1;
  }
  const s = world.stats();
  stats.textContent = `${viewName} · ${s.detail} detail · built in ${s.buildMs.toFixed(0)} ms · ${s.meshes} meshes · ${s.triangles.toLocaleString()} triangles in the district · ${renderer.info.render.calls} draw calls · ${renderer.info.render.triangles.toLocaleString()} triangles drawn`;
  (window as unknown as { __worldLab: unknown }).__worldLab = { ...s, drawCalls: renderer.info.render.calls, trianglesDrawn: renderer.info.render.triangles, updateMs, renderMs, intervalMs, frames };
});
