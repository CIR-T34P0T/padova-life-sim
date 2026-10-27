// A place to live (M10), in the room: each character's home, its weekly
// rent, and the furniture in it or in storage. Renting, changing room and
// moving out are interactions at the student housing's door (InteractionSystem
// calls the hooks below); furnishing is a message from the home panel. Every
// rule comes from shared/src/life/housing.ts and shared/src/homes.ts; every
// change is written to the database first and only then applied here. Home
// data goes only to its tenant (`housing` message), and only the tenant can
// enter the home.

import {
  FURNITURE,
  HOME_DOOR_ID,
  HOUSING_CONFIG,
  HOUSING_DOOR_ID,
  PLAZA_AREA,
  ServerMessage,
  cosinessOf,
  findInteractable,
  homeArea,
  homeAreaId,
  isCosy,
  isFurnitureId,
  isPositionWalkable,
  isRoomTypeId,
  overdueDeadline,
  parseFurnish,
  parsePlace,
  parsePutAway,
  placementRefusal,
  rentStep,
  rentWeekOf,
  GAME_CONFIG,
  type DoorLink,
  type FurnishResultPayload,
  type FurnitureView,
  type HomeView,
  type HousingNotice,
  type HousingPayload,
  type InteractionFailure,
  type MoodEventId,
  type PlacedFurnitureView,
  type RoomTypeId,
  type TransactionView,
} from "@padova/shared";
import type { AreaWorlds } from "../areas.ts";
import type { Database } from "../db/database.ts";
import type { GameClock } from "../life/LifeSystem.ts";
import { log } from "../log.ts";
import type { Owner } from "../profiles/profileRepository.ts";
import type { PendingAction, PlayerRuntime } from "../runtime.ts";
import type { StoryInput } from "../social/socialRepository.ts";
import {
  buyFurniture,
  chargeRent,
  markOverdue,
  moveCheaper,
  moveOut,
  placeFurniture,
  putAwayFurniture,
  rentRoom,
  type StoredFurniture,
  type StoredHome,
  type StoredHousing,
} from "./housingRepository.ts";

/** A character's current home, as the room keeps it. */
export interface HomeState {
  id: string;
  areaId: string;
  roomType: RoomTypeId;
  rentCents: number;
  paidWeek: number;
  overdueSince: number | null;
  placements: PlacedFurnitureView[];
}

/** Home and furniture, loaded with the character's life data. */
export interface LoadedHousing {
  home: HomeState | null;
  storage: FurnitureView[];
}

/**
 * Cleans stored housing. A room type or item this server doesn't know (from
 * a newer version) is ignored and left alone in the database, as with jobs.
 */
export function housingFromStored(stored: StoredHousing): LoadedHousing {
  const home = stored.home && isRoomTypeId(stored.home.roomType) ? toHomeState(stored.home, stored.home.roomType, stored.furniture) : null;
  return { home, storage: storageOf(stored.furniture) };
}

function toHomeState(home: StoredHome, roomType: RoomTypeId, furniture: readonly StoredFurniture[]): HomeState {
  const placements: PlacedFurnitureView[] = [];
  for (const piece of furniture) {
    if (piece.homeId !== home.id || !piece.slot || !isFurnitureId(piece.itemId)) continue;
    placements.push({ furnitureId: piece.id, itemId: piece.itemId, slot: piece.slot });
  }
  return { id: home.id, areaId: homeAreaId(home.id), roomType, rentCents: home.rentCents, paidWeek: home.paidWeek, overdueSince: home.overdueSince, placements };
}

const storageOf = (furniture: readonly StoredFurniture[]): FurnitureView[] =>
  furniture.flatMap((piece) => (piece.homeId === null && isFurnitureId(piece.itemId) ? [{ furnitureId: piece.id, itemId: piece.itemId }] : []));

/** What the interaction system asks about homes. */
export interface HousingHooks {
  /** The character's home (decides what the housing's door offers), or null. */
  homeOf(sessionId: string): { roomType: RoomTypeId } | null;
  /** The door link to this character's own home, or null without one. */
  homeLink(sessionId: string): DoorLink | null;
  /** At the housing's door: rents the room `pending.itemId` (or moves to it). */
  rent(sessionId: string, pending: PendingAction): Promise<"ok" | InteractionFailure>;
  /** At the housing's door: gives up the home. */
  moveOut(sessionId: string, pending: PendingAction): Promise<"ok" | InteractionFailure>;
  /** A sleep finished in the character's bed. */
  onSlept(sessionId: string): void;
}

export interface HousingDeps {
  db: Database;
  areas: AreaWorlds;
  runtimes: Map<string, PlayerRuntime>;
  ownerOf: (sessionId: string) => Owner | null;
  clock: GameClock;
  send: (sessionId: string, type: string, payload: unknown) => void;
  /** Money and mood (LifeSystem). */
  life: {
    balanceOf(sessionId: string): number | null;
    recordMoney(sessionId: string, balanceCents: number, transaction?: TransactionView): void;
    addMood(sessionId: string, id: MoodEventId): void;
  };
  story?: (sessionId: string, event: StoryInput) => void;
  /** Stops what the character is doing and stands them up (before their room changes around them). */
  interrupt: (sessionId: string) => void;
  /** Puts the character at a spot in an area (their new home, or the square when they lose their home while in it). */
  relocate: (sessionId: string, spot: { area: string; x: number; z: number; rotation: number }) => void;
  now: () => number;
}

interface CharacterHousing {
  owner: Owner;
  home: HomeState | null;
  storage: FurnitureView[];
  /** A database write is in flight: other changes wait (rent) or are refused as busy (furnishing). */
  busy: boolean;
  /** No rent attempt before this real time (after a failure). */
  retryAt: number;
}

/** After a failed rent write, wait this long before trying again. */
const RETRY_MS = 5_000;

export class HousingSystem implements HousingHooks {
  private readonly characters = new Map<string, CharacterHousing>();

  constructor(private readonly deps: HousingDeps) {}

  // ── Lifecycle ───────────────────────────────────────────────────────────

  /**
   * Registers the character's home as an area, before the character is
   * placed (so a character saved at home comes back there).
   */
  prepare(loaded: LoadedHousing): void {
    if (loaded.home) this.setArea(loaded.home);
  }

  attach(sessionId: string, owner: Owner, loaded: LoadedHousing): void {
    this.characters.set(sessionId, { owner, home: loaded.home, storage: loaded.storage, busy: false, retryAt: 0 });
    if (loaded.home) this.setArea(loaded.home);
    this.sendHousing(sessionId);
    this.processRent(sessionId);
  }

  /** Sends the home again (after a reconnection). */
  resync(sessionId: string): void {
    this.sendHousing(sessionId);
  }

  /** The character left the world (after its final save): forget its home's area. */
  detach(sessionId: string): void {
    const housing = this.characters.get(sessionId);
    if (housing?.home) this.deps.areas.removeHome(housing.home.areaId);
    this.characters.delete(sessionId);
  }

  /** Rent falls due on Mondays and is retried while overdue (called every tick). */
  tick(): void {
    for (const sessionId of this.characters.keys()) this.processRent(sessionId);
  }

  // ── Hooks for the interaction system ────────────────────────────────────

  homeOf(sessionId: string): { roomType: RoomTypeId } | null {
    const home = this.characters.get(sessionId)?.home;
    return home ? { roomType: home.roomType } : null;
  }

  homeLink(sessionId: string): DoorLink | null {
    const home = this.characters.get(sessionId)?.home;
    return home ? { to: home.areaId, door: HOME_DOOR_ID, actionLabel: "Go home" } : null;
  }

  /** Is this the character's own home? */
  isHomeOf(sessionId: string, areaId: string): boolean {
    return this.characters.get(sessionId)?.home?.areaId === areaId;
  }

  async rent(sessionId: string, pending: PendingAction): Promise<"ok" | InteractionFailure> {
    const housing = this.characters.get(sessionId);
    const roomType = pending.itemId;
    if (!housing || !isRoomTypeId(roomType)) return "rent_failed";
    if (housing.busy) return "busy";
    housing.busy = true;
    const gameMinute = this.deps.clock.minute();
    try {
      const result = await rentRoom(this.deps.db, housing.owner, { roomType, week: rentWeekOf(gameMinute), gameMinute, requestKey: `lease:${pending.requestId}` });
      if (!this.isCurrent(sessionId, housing)) return "rent_failed";
      switch (result.status) {
        case "not_owner":
          return "rent_failed";
        case "same_room":
          return "same_room";
        case "insufficient_funds":
          this.deps.life.recordMoney(sessionId, result.balanceCents);
          this.deps.life.addMood(sessionId, "couldnt_afford");
          return "insufficient_funds";
        case "rented":
        case "duplicate": {
          const previous = housing.home;
          housing.home = toHomeState(result.home, roomType, result.furniture);
          housing.storage = storageOf(result.furniture);
          if (previous && previous.areaId !== housing.home.areaId) this.deps.areas.removeHome(previous.areaId);
          this.setArea(housing.home);
          this.deps.life.recordMoney(sessionId, result.balanceCents, result.transaction);
          if (result.status === "rented") {
            this.deps.life.addMood(sessionId, "new_home");
            this.deps.story?.(sessionId, { key: `home:${housing.home.id}`, kind: "moved_in", gameMinute, details: { roomType } });
            log.info("housing", `${sessionId} rented a ${roomType}`);
          }
          this.sendHousing(sessionId);
          return "ok";
        }
      }
    } catch (error) {
      log.error("housing", `renting for ${sessionId} failed: ${(error as Error).message}`);
      return "rent_failed";
    } finally {
      housing.busy = false;
    }
  }

  async moveOut(sessionId: string, _pending: PendingAction): Promise<"ok" | InteractionFailure> {
    const housing = this.characters.get(sessionId);
    if (!housing) return "rent_failed";
    if (!housing.home) return "no_home";
    if (housing.busy) return "busy";
    housing.busy = true;
    const gameMinute = this.deps.clock.minute();
    try {
      const result = await moveOut(this.deps.db, housing.owner);
      if (!this.isCurrent(sessionId, housing)) return "rent_failed";
      if (result.status === "no_home") {
        this.clearHome(housing);
        this.sendHousing(sessionId);
        return "no_home";
      }
      const roomType = housing.home?.roomType;
      this.clearHome(housing);
      housing.storage = storageOf(result.furniture);
      this.deps.story?.(sessionId, { key: `moved-out:${result.homeId}`, kind: "moved_out", gameMinute, details: roomType ? { fromRoomType: roomType } : {} });
      this.sendHousing(sessionId);
      log.info("housing", `${sessionId} moved out`);
      return "ok";
    } catch (error) {
      log.error("housing", `moving out for ${sessionId} failed: ${(error as Error).message}`);
      return "rent_failed";
    } finally {
      housing.busy = false;
    }
  }

  onSlept(sessionId: string): void {
    this.cosyMood(sessionId);
  }

  /** The character just came home through the door. */
  onArrivedHome(sessionId: string): void {
    this.cosyMood(sessionId);
  }

  // ── Furnishing (messages from the home panel) ───────────────────────────

  async furnish(sessionId: string, payload: unknown): Promise<void> {
    const request = parseFurnish(payload);
    if (!request) return this.result(sessionId, { action: "furnish", status: "failed" });
    const result = (status: FurnishResultPayload["status"]) => this.result(sessionId, { action: "furnish", status, itemId: request.itemId });
    const housing = this.characters.get(sessionId);
    const home = housing?.home;
    if (!housing || !home || !this.inOwnHome(sessionId)) return result("not_home");
    const item = FURNITURE[request.itemId];
    if (item.priceCents === null) return result("not_for_sale");
    // A taken spot or a full storage is checked by the database, which first
    // recognises a repeated request (a lost reply) and answers "duplicate".
    const refusal = placementRefusal(home.roomType, home.placements, request.slot, request.itemId);
    if (refusal && refusal !== "slot_taken") return result(refusal);
    if (housing.busy) return result("busy");
    housing.busy = true;
    try {
      const bought = await buyFurniture(this.deps.db, housing.owner, {
        homeId: home.id,
        slot: request.slot,
        itemId: request.itemId,
        label: item.label,
        priceCents: item.priceCents,
        requestKey: `furniture:${request.requestId}`,
        gameMinute: this.deps.clock.minute(),
        maxFurniture: HOUSING_CONFIG.maxFurniture,
      });
      if (!this.isCurrent(sessionId, housing)) return;
      switch (bought.status) {
        case "insufficient_funds":
          this.deps.life.recordMoney(sessionId, bought.balanceCents);
          this.deps.life.addMood(sessionId, "couldnt_afford");
          return result("insufficient_funds");
        case "not_home":
        case "slot_taken":
        case "storage_full":
          return result(bought.status);
        case "bought":
        case "duplicate": {
          this.deps.life.recordMoney(sessionId, bought.balanceCents, bought.transaction);
          const piece = bought.piece;
          if (bought.status === "bought" && piece.homeId === home.id && piece.slot && isFurnitureId(piece.itemId)) {
            this.rearrange(sessionId, home, [...home.placements, { furnitureId: piece.id, itemId: piece.itemId, slot: piece.slot }]);
          }
          this.sendHousing(sessionId);
          log.info("housing", `${sessionId} bought a ${request.itemId}`);
          return result(bought.status === "bought" ? "ok" : "duplicate");
        }
      }
    } catch (error) {
      log.error("housing", `furnishing for ${sessionId} failed: ${(error as Error).message}`);
      result("failed");
    } finally {
      housing.busy = false;
    }
  }

  async place(sessionId: string, payload: unknown): Promise<void> {
    const request = parsePlace(payload);
    if (!request) return this.result(sessionId, { action: "place", status: "failed" });
    const housing = this.characters.get(sessionId);
    const home = housing?.home;
    const piece = housing?.storage.find((p) => p.furnitureId === request.furnitureId);
    const result = (status: FurnishResultPayload["status"]) => this.result(sessionId, { action: "place", status, ...(piece ? { itemId: piece.itemId } : {}) });
    if (!housing || !home || !this.inOwnHome(sessionId)) return result("not_home");
    if (!piece) return result("not_found");
    const refusal = placementRefusal(home.roomType, home.placements, request.slot, piece.itemId);
    if (refusal) return result(refusal);
    if (housing.busy) return result("busy");
    housing.busy = true;
    try {
      const placed = await placeFurniture(this.deps.db, housing.owner, home.id, piece.furnitureId, request.slot);
      if (!this.isCurrent(sessionId, housing)) return;
      if (placed !== "placed") return result(placed);
      housing.storage = housing.storage.filter((p) => p.furnitureId !== piece.furnitureId);
      this.rearrange(sessionId, home, [...home.placements, { ...piece, slot: request.slot }]);
      this.sendHousing(sessionId);
      result("ok");
    } catch (error) {
      log.error("housing", `placing for ${sessionId} failed: ${(error as Error).message}`);
      result("failed");
    } finally {
      housing.busy = false;
    }
  }

  async putAway(sessionId: string, payload: unknown): Promise<void> {
    const request = parsePutAway(payload);
    if (!request) return this.result(sessionId, { action: "putAway", status: "failed" });
    const housing = this.characters.get(sessionId);
    const home = housing?.home;
    const piece = home?.placements.find((p) => p.furnitureId === request.furnitureId);
    const result = (status: FurnishResultPayload["status"]) => this.result(sessionId, { action: "putAway", status, ...(piece ? { itemId: piece.itemId } : {}) });
    if (!housing || !home || !this.inOwnHome(sessionId)) return result("not_home");
    if (!piece) return result("not_found");
    if (housing.busy) return result("busy");
    housing.busy = true;
    try {
      const stored = await putAwayFurniture(this.deps.db, housing.owner, home.id, piece.furnitureId);
      if (!this.isCurrent(sessionId, housing)) return;
      if (stored !== "stored") return result(stored);
      housing.storage = [...housing.storage, { furnitureId: piece.furnitureId, itemId: piece.itemId }];
      this.rearrange(sessionId, home, home.placements.filter((p) => p.furnitureId !== piece.furnitureId));
      this.sendHousing(sessionId);
      result("ok");
    } catch (error) {
      log.error("housing", `putting away for ${sessionId} failed: ${(error as Error).message}`);
      result("failed");
    } finally {
      housing.busy = false;
    }
  }

  // ── Rent ────────────────────────────────────────────────────────────────

  private processRent(sessionId: string): void {
    const housing = this.characters.get(sessionId);
    const home = housing?.home;
    if (!housing || !home || housing.busy || this.deps.now() < housing.retryAt) return;
    const balance = this.deps.life.balanceOf(sessionId);
    if (balance === null) return;
    const gameMinute = this.deps.clock.minute();
    const step = rentStep(home, gameMinute, balance);
    if (step === "paid" || step === "overdue") return;
    housing.busy = true;
    const write =
      step === "charge" ? this.charge(sessionId, housing, home, gameMinute) : step === "start_overdue" ? this.startOverdue(sessionId, housing, home, gameMinute) : this.moveDown(sessionId, housing, home, gameMinute);
    void write
      .catch((error) => {
        housing.retryAt = this.deps.now() + RETRY_MS;
        log.error("housing", `rent for ${sessionId} failed: ${(error as Error).message}`);
      })
      .finally(() => {
        housing.busy = false;
      });
  }

  private async charge(sessionId: string, housing: CharacterHousing, home: HomeState, gameMinute: number): Promise<void> {
    const week = rentWeekOf(gameMinute);
    const result = await chargeRent(this.deps.db, housing.owner, home.id, week, gameMinute);
    if (!this.isCurrent(sessionId, housing) || housing.home !== home) return;
    switch (result.status) {
      case "paid":
        home.paidWeek = result.week;
        home.overdueSince = null;
        this.deps.life.recordMoney(sessionId, result.balanceCents, result.transaction);
        this.sendHousing(sessionId, { kind: "rent_paid", rentCents: home.rentCents });
        return;
      case "already_paid":
        home.paidWeek = result.paidWeek;
        home.overdueSince = null;
        this.sendHousing(sessionId);
        return;
      case "insufficient_funds":
        // The room's balance was out of date: use the ledger's, and decide again next tick.
        this.deps.life.recordMoney(sessionId, result.balanceCents);
        return;
      case "no_home":
        housing.retryAt = this.deps.now() + RETRY_MS;
        log.warn("housing", `rent for ${sessionId}: home ${home.id} is no longer current`);
        return;
    }
  }

  private async startOverdue(sessionId: string, housing: CharacterHousing, home: HomeState, gameMinute: number): Promise<void> {
    const since = await markOverdue(this.deps.db, housing.owner, home.id, gameMinute);
    if (!this.isCurrent(sessionId, housing) || housing.home !== home) return;
    if (since === null) {
      housing.retryAt = this.deps.now() + RETRY_MS;
      return;
    }
    home.overdueSince = since;
    this.deps.life.addMood(sessionId, "rent_worry");
    this.sendHousing(sessionId, { kind: "rent_overdue", rentCents: home.rentCents, deadlineGameMinute: overdueDeadline(since) });
    log.info("housing", `${sessionId} couldn't pay the rent; grace period until game minute ${Math.round(overdueDeadline(since))}`);
  }

  private async moveDown(sessionId: string, housing: CharacterHousing, home: HomeState, gameMinute: number): Promise<void> {
    const result = await moveCheaper(this.deps.db, housing.owner, home.id, rentWeekOf(gameMinute), gameMinute);
    if (!this.isCurrent(sessionId, housing) || housing.home !== home) return;
    if (result.status !== "moved") {
      housing.retryAt = this.deps.now() + RETRY_MS;
      return;
    }
    const wasInside = this.deps.runtimes.get(sessionId)?.area === home.areaId;
    if (wasInside) this.deps.interrupt(sessionId);
    const to = result.to && isRoomTypeId(result.to.roomType) ? toHomeState(result.to, result.to.roomType, result.furniture) : null;
    this.deps.areas.removeHome(home.areaId);
    housing.home = to;
    housing.storage = storageOf(result.furniture);
    if (to) this.setArea(to);
    if (wasInside) this.relocate(sessionId, to);
    this.deps.life.recordMoney(sessionId, result.balanceCents, result.transaction ?? undefined);
    this.deps.life.addMood(sessionId, "had_to_move");
    this.deps.story?.(sessionId, {
      key: `rent-trouble:${home.id}`,
      kind: "rent_trouble",
      gameMinute,
      details: to ? { fromRoomType: home.roomType, roomType: to.roomType } : { fromRoomType: home.roomType },
    });
    this.sendHousing(sessionId, to ? { kind: "moved_cheaper", fromRoomType: home.roomType, roomType: to.roomType, rentCents: to.rentCents } : { kind: "moved_out_unpaid", fromRoomType: home.roomType });
    log.info("housing", `${sessionId} couldn't pay the rent: moved from a ${home.roomType} to ${to ? `a ${to.roomType}` : "nowhere"}`);
  }

  // ── Internals ───────────────────────────────────────────────────────────

  private setArea(home: HomeState): void {
    this.deps.areas.setHome(home.areaId, homeArea(home.areaId, home.roomType, home.placements).layout);
  }

  private clearHome(housing: CharacterHousing): void {
    if (housing.home) this.deps.areas.removeHome(housing.home.areaId);
    housing.home = null;
  }

  /**
   * The furniture in the home changed: stop what the tenant is doing (they
   * may be sitting on the piece), rebuild the room, and if they now stand
   * inside a piece, put them back by the door.
   */
  private rearrange(sessionId: string, home: HomeState, placements: PlacedFurnitureView[]): void {
    this.deps.interrupt(sessionId);
    home.placements = placements;
    this.setArea(home);
    const runtime = this.deps.runtimes.get(sessionId);
    if (!runtime || runtime.area !== home.areaId) return;
    const layout = this.deps.areas.of(home.areaId).layout;
    if (!isPositionWalkable(layout, runtime.character.x, runtime.character.z, GAME_CONFIG.playerRadius)) {
      const spawn = layout.spawnPoints[0]!;
      this.deps.relocate(sessionId, { area: home.areaId, x: spawn.x, z: spawn.z, rotation: Math.PI });
    }
  }

  /** After losing the home they were in: into the new home by its door, or out in front of the housing. */
  private relocate(sessionId: string, to: HomeState | null): void {
    if (to) {
      const spawn = this.deps.areas.of(to.areaId).layout.spawnPoints[0]!;
      this.deps.relocate(sessionId, { area: to.areaId, x: spawn.x, z: spawn.z, rotation: Math.PI });
      return;
    }
    const spot = findInteractable(this.deps.areas.plaza.layout, HOUSING_DOOR_ID)?.seats[0];
    const fallback = this.deps.areas.plaza.layout.spawnPoints[0]!;
    this.deps.relocate(sessionId, spot ? { area: PLAZA_AREA, x: spot.approach.x, z: spot.approach.z, rotation: spot.rotation + Math.PI } : { area: PLAZA_AREA, x: fallback.x, z: fallback.z, rotation: Math.PI });
  }

  private cosyMood(sessionId: string): void {
    const home = this.characters.get(sessionId)?.home;
    if (home && this.inOwnHome(sessionId) && isCosy(cosinessOf(home.placements.map((p) => p.itemId)))) this.deps.life.addMood(sessionId, "cosy_home");
  }

  private inOwnHome(sessionId: string): boolean {
    const runtime = this.deps.runtimes.get(sessionId);
    return runtime !== undefined && this.isHomeOf(sessionId, runtime.area);
  }

  /** Still the same character in the world (not left or replaced while the database answered). */
  private isCurrent(sessionId: string, housing: CharacterHousing): boolean {
    return this.characters.get(sessionId) === housing;
  }

  private sendHousing(sessionId: string, notice?: HousingNotice): void {
    const housing = this.characters.get(sessionId);
    if (!housing) return;
    const payload: HousingPayload = { home: housing.home ? homeView(housing.home) : null, storage: housing.storage, ...(notice ? { notice } : {}) };
    this.deps.send(sessionId, ServerMessage.Housing, payload);
  }

  private result(sessionId: string, payload: FurnishResultPayload): void {
    this.deps.send(sessionId, ServerMessage.FurnishResult, payload);
  }

  /** Read-only snapshot for tests. */
  debugHome(sessionId: string): HomeState | null {
    return this.characters.get(sessionId)?.home ?? null;
  }
}

function homeView(home: HomeState): HomeView {
  return {
    areaId: home.areaId,
    roomType: home.roomType,
    rentCents: home.rentCents,
    paidWeek: home.paidWeek,
    overdue: home.overdueSince === null ? null : { sinceGameMinute: home.overdueSince, deadlineGameMinute: overdueDeadline(home.overdueSince) },
    placements: home.placements,
    cosiness: cosinessOf(home.placements.map((p) => p.itemId)),
  };
}
