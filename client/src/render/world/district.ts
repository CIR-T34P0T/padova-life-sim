// Assembles the whole district as a list of owned geometry pieces (D-033).
// Pure geometry (no WebGL, no DOM), so tests can build it in Node and check
// every solid piece against the collision boxes it claims to stand in.

import * as THREE from "three";
import type { WorldLayout } from "@padova/shared";
import { buildBackdrop } from "./backdrop.ts";
import { BUILDING_BATCH, buildBuildings } from "./buildings.ts";
import { buildGround } from "./ground.ts";
import { Sink, type Detail } from "./kit.ts";
import { buildProps } from "./props.ts";

export function buildDistrict(layout: WorldLayout, detail: Detail): Sink {
  const sink = new Sink();
  buildGround(sink, layout, detail);
  buildBuildings(sink, layout, detail);
  buildProps(sink, layout, detail);
  buildBackdrop(sink, layout, detail);
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
