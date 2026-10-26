// Assembles the whole district as a list of owned geometry pieces (D-033).
// Pure geometry (no WebGL, no DOM), so tests can build it in Node and check
// every solid piece against the collision boxes it claims to stand in.

import * as THREE from "three";
import type { WorldLayout } from "@padova/shared";
import { buildBackdrop } from "./backdrop.ts";
import { BUILDING_BATCH, buildBuildings } from "./buildings.ts";
import { buildGround } from "./ground.ts";
import { Sink, flatRect, type Detail } from "./kit.ts";
import { buildProps } from "./props.ts";

export function buildDistrict(layout: WorldLayout, detail: Detail): Sink {
  const sink = new Sink();
  buildGround(sink, layout, detail);
  buildBuildings(sink, layout, detail);
  buildProps(sink, layout, detail);
  buildBackdrop(sink, layout, detail);
  return sink;
}

/** Floor details of an indoor room (M7c, D-039): every prop of its layout, walls included, plus a runner rug from the door. */
export function buildInterior(layout: WorldLayout, detail: Detail, floor: { minX: number; maxX: number; minZ: number; maxZ: number }): Sink {
  const sink = new Sink();
  buildProps(sink, layout, detail);
  // A long rug from the door into the room: flat decoration, walked over.
  sink.add("ground", null, flatRect(-0.8, 0.8, floor.minZ + 1.2, floor.maxZ - 0.15, 0.012, "#8c2f39"));
  return sink;
}

/** Tallest point of each building's fade volume (roofs, the hall's clock tower). */
const FADE_TOP: Record<string, number> = {
  "building:hall": 31,
  "building:library": 19,
  "building:residences": 18,
  "building:portico": 16,
  "building:housing": 16,
  "building:shops": 17,
};

/**
 * Volumes that decide when a building or a tree canopy hides your character:
 * the building's collision boxes raised to its roof, plus parts that overhang
 * walkable ground high up (the portico's upper floors, the rooms over the
 * hall's porch). Canopies use their own bounds, slightly shrunk.
 */
export function fadeVolumes(layout: WorldLayout, sink: Sink): Map<string, THREE.Box3[]> {
  const volumes = new Map<string, THREE.Box3[]>();
  const add = (group: string, box: THREE.Box3) => {
    const list = volumes.get(group) ?? [];
    list.push(box);
    volumes.set(group, list);
  };
  for (const o of layout.obstacles) {
    // Inside walls (M7c) fade like buildings when they hide you or the camera is beside them;
    // so does a room's door, which stands in a wall.
    const indoorDoor = o.kind === "door" && layout.obstacles.some((w) => w.kind === "wall");
    if (o.kind === "wall" || indoorDoor) add(`building:${o.id}`, new THREE.Box3(new THREE.Vector3(o.minX, 0, o.minZ), new THREE.Vector3(o.maxX, o.height, o.maxZ)));
    const group = BUILDING_BATCH[o.id];
    if (!group) continue;
    add(group, new THREE.Box3(new THREE.Vector3(o.minX, 0, o.minZ), new THREE.Vector3(o.maxX, FADE_TOP[group] ?? o.height + 4, o.maxZ)));
  }
  const columns = layout.obstacles.filter((o) => o.kind === "arcade");
  const portico = layout.obstacles.find((o) => o.id === "east-block");
  if (portico && columns.length > 0) {
    add("building:portico", new THREE.Box3(new THREE.Vector3(Math.min(...columns.map((c) => c.minX)), 4.6, portico.minZ), new THREE.Vector3(portico.minX, FADE_TOP["building:portico"]!, portico.maxZ)));
  }
  const porch = layout.obstacles.find((o) => o.id === "north-west-block-porch");
  if (porch) add("building:hall", new THREE.Box3(new THREE.Vector3(porch.minX, 5, porch.minZ), new THREE.Vector3(porch.maxX, FADE_TOP["building:hall"]!, -18)));
  // Tree canopies.
  const canopies = new Map<string, THREE.Box3>();
  for (const piece of sink.pieces) {
    if (!piece.batch.startsWith("canopy:")) continue;
    piece.geometry.computeBoundingBox();
    const box = canopies.get(piece.batch) ?? new THREE.Box3();
    box.union(piece.geometry.boundingBox!);
    canopies.set(piece.batch, box);
  }
  for (const [group, box] of canopies) {
    const centre = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).multiplyScalar(0.82);
    add(group, new THREE.Box3().setFromCenterAndSize(centre, size));
  }
  return volumes;
}

/** The fade group a draw batch belongs to (signs fade with their building), or null. */
export function fadeGroupOf(batch: string): string | null {
  if (batch.startsWith("canopy:")) return batch;
  if (batch.startsWith("building:")) return batch.split(":").slice(0, 2).join(":");
  return null;
}
