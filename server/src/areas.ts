// The areas this room simulates (M7c, D-039): the square and the indoor
// rooms, each with its own layout and navigation grid. Every character is in
// exactly one area (PlayerRuntime.area); movement, collision and interactions
// use that area's layout.

import { AREAS, GAME_CONFIG, NavGrid, PLAZA_AREA, findInteractable, type DoorLink, type WorldLayout } from "@padova/shared";

export interface AreaWorld {
  id: string;
  layout: WorldLayout;
  nav: NavGrid;
}

export class AreaWorlds {
  private readonly worlds = new Map<string, AreaWorld>();

  /** `plaza` replaces the square's layout (tests use small custom squares). */
  constructor(plaza: WorldLayout) {
    for (const area of Object.values(AREAS)) {
      const layout = area.id === PLAZA_AREA ? plaza : area.layout;
      this.worlds.set(area.id, { id: area.id, layout, nav: new NavGrid(layout, GAME_CONFIG.navCellSize, GAME_CONFIG.playerRadius, GAME_CONFIG.maxPathExpansions) });
    }
  }

  get plaza(): AreaWorld {
    return this.worlds.get(PLAZA_AREA)!;
  }

  has(id: string): boolean {
    return this.worlds.has(id);
  }

  /** The area with this id; the square for an unknown id (a removed room, a bad save). */
  of(id: string): AreaWorld {
    return this.worlds.get(id) ?? this.plaza;
  }

  /** Where a door delivers you: in front of the linked door, facing away from it. Null if it leads nowhere. */
  arrival(link: DoorLink): { area: string; x: number; z: number; rotation: number } | null {
    const target = this.worlds.get(link.to);
    const door = target ? findInteractable(target.layout, link.door) : null;
    const spot = door?.seats[0];
    if (!target || !door || door.kind !== "door" || !spot) return null;
    return { area: target.id, x: spot.approach.x, z: spot.approach.z, rotation: spot.rotation + Math.PI };
  }
}
