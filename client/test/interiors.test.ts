// Indoor rooms' art agrees with their collision layouts (M7c, D-033, D-039):
// the same checks as the square's district test, for every room at both
// detail levels. Homes (M10) are checked for every room type, empty and with
// every piece of furniture in the catalogue placed in its spots.

import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { AREAS, AREA_IDS, FURNITURE, FURNITURE_IDS, HOME_TEMPLATES, ROOM_TYPE_IDS, homeArea, type AreaDefinition, type FurnitureId, type Obstacle, type Placement, type RoomTypeId } from "@padova/shared";
import { buildInterior, fadeVolumes } from "../src/render/world/district.ts";
import type { Detail, Piece } from "../src/render/world/kit.ts";
import { HEAD_HEIGHT } from "../src/render/world/props.ts";

const TOLERANCE = 0.06;
const FLAT = 0.03;
/** Every spot filled with the n-th catalogue item of its category (wrapping round), so each item is drawn somewhere. */
function furnished(roomType: RoomTypeId, n: number): Placement[] {
  return HOME_TEMPLATES[roomType].slots.map((slot, k) => {
    const options = FURNITURE_IDS.filter((id) => FURNITURE[id].category === slot.category && FURNITURE[id].priceCents !== null);
    return { slot: slot.id, itemId: options[(n + k) % options.length] as FurnitureId };
  });
}
const homes: [string, AreaDefinition][] = ROOM_TYPE_IDS.flatMap((roomType) => [
  [`home ${roomType} (empty)`, homeArea("home/test", roomType, [])] as [string, AreaDefinition],
  ...[0, 1, 2].map((n) => [`home ${roomType} (furnished ${n + 1})`, homeArea("home/test", roomType, furnished(roomType, n))] as [string, AreaDefinition]),
]);
const rooms: [string, AreaDefinition][] = [...AREA_IDS.filter((id) => AREAS[id]!.indoor).map((id) => [id, AREAS[id]!] as [string, AreaDefinition]), ...homes];
const inside = (o: Obstacle, x: number, z: number, margin: number) => x >= o.minX - margin && x <= o.maxX + margin && z >= o.minZ - margin && z <= o.maxZ + margin;
const vertices = (piece: Piece) => {
  const position = piece.geometry.getAttribute("position");
  return Array.from({ length: position.count }, (_, i) => new THREE.Vector3().fromBufferAttribute(position, i));
};

describe.each(rooms.flatMap(([id, area]) => (["high", "low"] as const).map((detail) => [id, detail, area] as [string, Detail, AreaDefinition])))("room %s (%s detail)", (id, detail, area) => {
  const layout = area.layout;
  const pieces = buildInterior(layout, detail, area.floor!).pieces;
  const byId = new Map(layout.obstacles.map((o) => [o.id, o]));

  it("draws nothing solid below head height outside the box it stands in", () => {
    const problems = new Map<string, number>();
    for (const piece of pieces) {
      if (!piece.owner) continue;
      const box = byId.get(piece.owner);
      expect(box, `piece owned by unknown obstacle ${piece.owner}`).toBeTruthy();
      for (const v of vertices(piece)) {
        if (v.y < HEAD_HEIGHT && !inside(box!, v.x, v.z, TOLERANCE)) problems.set(piece.owner, (problems.get(piece.owner) ?? 0) + 1);
      }
    }
    expect(Object.fromEntries(problems)).toEqual({});
  });

  it("keeps decoration flat (the rug) or above head height", () => {
    for (const piece of pieces.filter((p) => !p.owner)) {
      for (const v of vertices(piece)) expect(v.y <= FLAT || v.y >= HEAD_HEIGHT, piece.batch).toBe(true);
    }
  });

  it("fills every collision box with something visible (no invisible walls)", () => {
    const extents = new Map<string, THREE.Box3>();
    for (const piece of pieces) {
      if (!piece.owner) continue;
      const box = extents.get(piece.owner) ?? new THREE.Box3();
      for (const v of vertices(piece)) if (v.y < HEAD_HEIGHT) box.expandByPoint(v);
      extents.set(piece.owner, box);
    }
    const thin: string[] = [];
    for (const o of layout.obstacles) {
      const drawn = extents.get(o.id);
      if (!drawn || drawn.isEmpty()) {
        thin.push(`${o.id}: nothing drawn`);
        continue;
      }
      const coverX = (Math.min(drawn.max.x, o.maxX) - Math.max(drawn.min.x, o.minX)) / (o.maxX - o.minX);
      const coverZ = (Math.min(drawn.max.z, o.maxZ) - Math.max(drawn.min.z, o.minZ)) / (o.maxZ - o.minZ);
      if (coverX < 0.85 || coverZ < 0.85) thin.push(`${o.id}: covers ${(coverX * 100).toFixed(0)}% × ${(coverZ * 100).toFixed(0)}%`);
    }
    expect(thin).toEqual([]);
  });

  it("gives every clickable object its own mesh, every wall a fade volume, and every piece a glow strength", () => {
    const batches = new Set(pieces.map((p) => p.batch));
    for (const item of layout.interactables) expect(batches.has(`interactable:${item.id}`), item.id).toBe(true);
    const volumes = fadeVolumes(layout, { pieces } as never);
    for (const wall of layout.obstacles.filter((o) => o.kind === "wall")) {
      expect(volumes.get(`building:${wall.id}`)?.length, wall.id).toBe(1);
      expect(batches.has(`building:${wall.id}`), wall.id).toBe(true);
    }
    for (const piece of pieces) expect(piece.geometry.getAttribute("glow")?.count).toBe(piece.geometry.getAttribute("position").count);
  });

  it("stays within a small triangle budget (a room is drawn only while you are in it)", () => {
    let triangles = 0;
    for (const piece of pieces) triangles += (piece.geometry.index?.count ?? piece.geometry.getAttribute("position").count) / 3;
    expect(triangles).toBeLessThan(detail === "high" ? 60_000 : 30_000);
    console.log(`[room] ${id} ${detail}: ${Math.round(triangles)} triangles`);
  });
});
