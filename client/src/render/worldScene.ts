// Builds the greybox piazza from the SHARED world layout, so what the player
// sees always matches what the server collides against. All visuals here are
// placeholders (flat-coloured boxes).

import * as THREE from "three";
import type { ObstacleKind, WorldLayout } from "@padova/shared";
import type { QualityProfile } from "./quality.ts";

const KIND_COLOURS: Record<ObstacleKind, number> = {
  building: 0xe8c9a0, // warm plaster
  arcade: 0xd9b48a,
  fountain: 0xbfc9cc,
  stall: 0xc4623f, // terracotta awnings
  bench: 0x8a6a4f,
  planter: 0x6f8f4e,
  desk: 0x9a7b5a,
  counter: 0x6e4a33,
};

const SELECTED_EDGE = 0xc4623f;
const HOVER_EDGE = 0xf2b89c;

export interface WorldScene {
  scene: THREE.Scene;
  /** Meshes a tap can land on: the walkable ground. */
  ground: THREE.Mesh;
  /** Meshes that block movement (taps on these are refused locally). */
  blockers: THREE.Object3D[];
  /** Ground ring shown where the player last asked to walk. */
  targetMarker: THREE.Mesh;
  /** Meshes of clickable objects, keyed by interactable id (`userData.interactableId`). */
  interactableMeshes: Map<string, THREE.Mesh>;
  /** Shows an outline on one object as selected and/or another as hovered (null clears). */
  highlight(selectedId: string | null, hoveredId: string | null): void;
}

export function buildWorldScene(world: WorldLayout, quality: QualityProfile): WorldScene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xa9cde0);
  scene.fog = new THREE.Fog(0xa9cde0, 45, 110);

  const hemi = new THREE.HemisphereLight(0xfff4e0, 0x7a6a58, 1.6);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0d8, 2.2);
  sun.position.set(-18, 30, 12);
  if (quality.shadows) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const extent = world.halfSize + 4;
    Object.assign(sun.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent, near: 1, far: 90 });
    sun.shadow.bias = -0.0005;
  }
  scene.add(sun);

  const size = world.halfSize * 2;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshStandardMaterial({ color: 0xd8cdbb, roughness: 0.95 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = quality.shadows;
  ground.name = "ground";
  scene.add(ground);

  // Paving grid lines give a sense of scale and movement.
  const grid = new THREE.GridHelper(size, size / 2, 0xbfb29e, 0xc9bda9);
  grid.position.y = 0.01;
  scene.add(grid);

  // Low boundary kerb so the edge of the play area is visible.
  const kerbMaterial = new THREE.MeshStandardMaterial({ color: 0xa89a86 });
  const kerbGeometry = new THREE.BoxGeometry(size + 0.6, 0.3, 0.3);
  for (const [x, z, rotate] of [
    [0, -world.halfSize, false],
    [0, world.halfSize, false],
    [-world.halfSize, 0, true],
    [world.halfSize, 0, true],
  ] as const) {
    const kerb = new THREE.Mesh(kerbGeometry, kerbMaterial);
    kerb.position.set(x, 0.15, z);
    if (rotate) kerb.rotation.y = Math.PI / 2;
    scene.add(kerb);
  }

  const blockers: THREE.Object3D[] = [];
  const interactableMeshes = new Map<string, THREE.Mesh>();
  const interactableIds = new Set(world.interactables.map((item) => item.id));
  const materials = new Map<ObstacleKind, THREE.MeshStandardMaterial>();
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  for (const obstacle of world.obstacles) {
    let material = materials.get(obstacle.kind);
    if (!material) {
      material = new THREE.MeshStandardMaterial({ color: KIND_COLOURS[obstacle.kind], roughness: 0.85 });
      materials.set(obstacle.kind, material);
    }
    const width = obstacle.maxX - obstacle.minX;
    const depth = obstacle.maxZ - obstacle.minZ;
    const mesh = new THREE.Mesh(unitBox, material);
    mesh.scale.set(width, obstacle.height, depth);
    mesh.position.set((obstacle.minX + obstacle.maxX) / 2, obstacle.height / 2, (obstacle.minZ + obstacle.maxZ) / 2);
    mesh.castShadow = quality.shadows;
    mesh.receiveShadow = quality.shadows;
    mesh.name = obstacle.id;
    mesh.userData.label = obstacle.label;
    if (interactableIds.has(obstacle.id)) {
      mesh.userData.interactableId = obstacle.id;
      interactableMeshes.set(obstacle.id, mesh);
    }
    scene.add(mesh);
    blockers.push(mesh);
  }

  // One outline object, re-parented onto whichever object is highlighted.
  // It is a child of the (scaled) unit box, so a unit-box outline fits exactly.
  const edgeGeometry = new THREE.EdgesGeometry(unitBox);
  const makeOutline = (color: number) => {
    const outline = new THREE.LineSegments(edgeGeometry, new THREE.LineBasicMaterial({ color, depthTest: false }));
    outline.scale.setScalar(1.04);
    outline.renderOrder = 10;
    outline.visible = false;
    outline.raycast = () => undefined; // never pickable
    return outline;
  };
  const selectedOutline = makeOutline(SELECTED_EDGE);
  const hoverOutline = makeOutline(HOVER_EDGE);
  const attach = (outline: THREE.LineSegments, id: string | null) => {
    const mesh = id ? interactableMeshes.get(id) : undefined;
    if (!mesh) {
      outline.visible = false;
      outline.removeFromParent();
      return;
    }
    if (outline.parent !== mesh) mesh.add(outline);
    outline.visible = true;
  };
  const highlight = (selectedId: string | null, hoveredId: string | null) => {
    attach(selectedOutline, selectedId);
    attach(hoverOutline, hoveredId && hoveredId !== selectedId ? hoveredId : null);
  };

  const targetMarker = new THREE.Mesh(
    new THREE.RingGeometry(0.35, 0.5, 32),
    new THREE.MeshBasicMaterial({ color: 0xc4623f, transparent: true, opacity: 0.9, depthWrite: false }),
  );
  targetMarker.rotation.x = -Math.PI / 2;
  targetMarker.position.y = 0.03;
  targetMarker.visible = false;
  scene.add(targetMarker);

  return { scene, ground, blockers, targetMarker, interactableMeshes, highlight };
}
