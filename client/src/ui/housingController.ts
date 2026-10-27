// A place to live on the client (M10): your home and storage as the server
// last sent them, the room drawn from them, rent notices, the renting and
// moving-out dialogs at the student housing's door, and the furnishing panel.
// Every decision is the server's; this only asks and shows the answers.

import {
  FURNITURE,
  ROOMS_BY_RENT,
  ROOM_TYPES,
  formatEuros,
  homeArea,
  type AreaDefinition,
  type FurnishResultPayload,
  type FurnitureId,
  type FurnitureView,
  type HomeView,
  type HousingPayload,
  type LifePayload,
  type RoomTypeId,
} from "@padova/shared";
import type { GameConnection } from "../net/connection.ts";
import type { CharacterPanel } from "./characterPanel.ts";
import { HomePanel } from "./homePanel.ts";
import { furnitureLabel, noticeText, roomLabel } from "./housing.ts";
import type { Hud } from "./hud.ts";
import { Dialog } from "./screens/dialog.ts";

export interface HousingDeps {
  connection: GameConnection;
  hud: Hud;
  characterPanel: CharacterPanel;
  life(): LifePayload | null;
  gameMinute(): number | null;
  /** Close other sheets before the panel opens (touch shows one sheet at a time). */
  closeOthers(): void;
  /** The home changed (rented, moved, furniture moved, lost): the game redraws what it must. */
  onHomeChanged(previous: HomeView | null, next: HomeView | null): void;
}

/** Idempotency id for renting and buying. Uses getRandomValues, which works on plain-http LAN pages too. */
function newRequestId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `c-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

const FURNISH_FAILURE: Record<string, string> = {
  not_home: "Go home to furnish your room.",
  unknown_item: "That isn't in the catalogue.",
  not_for_sale: "That comes with the room; it isn't for sale.",
  unknown_slot: "That spot isn't in your room.",
  wrong_slot: "That doesn't go in that spot.",
  slot_taken: "Something is already there. Put it away first.",
  insufficient_funds: "You can't afford that right now.",
  storage_full: "You own as much furniture as you can keep.",
  not_found: "That piece isn't there any more.",
  busy: "One thing at a time: wait for the last change.",
  failed: "That didn't work because of a server problem. Nothing was charged; try again in a moment.",
};

export class HousingController {
  readonly panel: HomePanel;
  private homeView: HomeView | null = null;
  private storageView: FurnitureView[] = [];
  private dialog: Dialog | null = null;
  /** Built rooms by home, kept until the home or its furniture changes. */
  private built: { key: string; area: AreaDefinition } | null = null;

  constructor(
    root: HTMLElement,
    private readonly deps: HousingDeps,
  ) {
    this.panel = new HomePanel(root, {
      onBuy: (slot, itemId) => deps.connection.furnish(slot, itemId, newRequestId()),
      onPlace: (slot, furnitureId) => deps.connection.place(slot, furnitureId),
      onPutAway: (furnitureId) => deps.connection.putAway(furnitureId),
      onClose: () => undefined,
    });
  }

  get home(): HomeView | null {
    return this.homeView;
  }

  get storage(): readonly FurnitureView[] {
    return this.storageView;
  }

  /** The room of your home, built from what the server sent; undefined for any other id. */
  areaFor(areaId: string): AreaDefinition | undefined {
    const home = this.homeView;
    if (!home || home.areaId !== areaId) return undefined;
    const key = JSON.stringify([home.areaId, home.roomType, home.placements]);
    if (this.built?.key !== key) {
      const placements = home.placements.map((p) => ({ slot: p.slot, itemId: p.itemId }));
      this.built = { key, area: homeArea(home.areaId, home.roomType, placements) };
    }
    return this.built.area;
  }

  /** Back at the title screen: the next character sends its own home. */
  reset(): void {
    const previous = this.homeView;
    this.homeView = null;
    this.storageView = [];
    this.built = null;
    this.panel.close();
    this.dialog?.close();
    if (previous) this.deps.onHomeChanged(previous, null);
  }

  openPanel(): void {
    this.deps.closeOthers();
    this.panel.update(this.homeView, this.storageView, this.deps.life()?.money.balanceCents ?? null);
    this.panel.open();
  }

  /** Life data changed (money): keep the panel's prices truthful. */
  onLife(life: LifePayload): void {
    this.panel.update(this.homeView, this.storageView, life.money.balanceCents);
  }

  // ── Dialogs at the student housing's door ───────────────────────────────

  /** Renting a room, or changing room when you have one. */
  openRent(doorId: string): void {
    const current = this.homeView?.roomType ?? null;
    const balance = this.deps.life()?.money.balanceCents ?? null;
    const requestId = newRequestId(); // one per dialog: a double confirm rents once
    const options = ROOMS_BY_RENT.filter((id) => id !== current).map((id) => {
      const room = ROOM_TYPES[id];
      const short = balance !== null && balance < room.rentCents;
      return { id, label: `${room.label} · ${formatEuros(room.rentCents)} a week${short ? " · not enough money" : ""} — ${room.description}` };
    });
    this.dialog?.close();
    this.dialog = new Dialog({
      title: current ? "Change room" : "Rent a room",
      body: [
        "Rooms in the student housing (fictional). The first week's rent is paid now; after that it's taken every Monday.",
        "If you can't pay, you have 12 game hours to find the money; then you move to a cheaper room you can afford. Never into debt.",
        ...(current ? [`You live in a ${roomLabel(current).toLowerCase()} now. Moving puts your furniture into storage.`] : []),
      ],
      choices: { label: "Which room?", options },
      confirmLabel: current ? "Move" : "Rent",
      onConfirm: (_value, dialog, choice) => {
        if (!choice) return;
        this.deps.connection.interact({ targetKind: "object", targetId: doorId, action: "rent", itemId: choice as RoomTypeId, requestId });
        dialog.close();
      },
    });
  }

  confirmMoveOut(doorId: string): void {
    const home = this.homeView;
    if (!home) return;
    this.dialog?.close();
    this.dialog = new Dialog({
      title: "Move out?",
      body: [
        `You'll give up your ${roomLabel(home.roomType).toLowerCase()}. This week's rent isn't paid back.`,
        "Your furniture goes into storage, ready for your next room.",
      ],
      confirmLabel: "Move out",
      danger: true,
      onConfirm: (_value, dialog) => {
        this.deps.connection.interact({ targetKind: "object", targetId: doorId, action: "move_out" });
        dialog.close();
      },
    });
  }

  // ── Server messages ─────────────────────────────────────────────────────

  onHousing(payload: HousingPayload): void {
    const previous = this.homeView;
    this.homeView = payload.home;
    this.storageView = payload.storage;
    if (payload.notice) this.deps.hud.toast(noticeText(payload.notice, this.deps.gameMinute()), 7000);
    this.deps.characterPanel.setHousing(payload.home, payload.storage);
    this.panel.update(payload.home, payload.storage, this.deps.life()?.money.balanceCents ?? null);
    if (!payload.home) this.panel.close();
    this.deps.onHomeChanged(previous, payload.home);
  }

  onFurnishResult(payload: FurnishResultPayload): void {
    this.panel.answered();
    const name = payload.itemId ? furnitureLabel(payload.itemId) : "it";
    if (payload.status === "ok") {
      if (payload.action === "furnish" && payload.itemId) {
        const price = FURNITURE[payload.itemId as FurnitureId].priceCents ?? 0;
        this.deps.hud.toast(`Bought: ${name}, ${formatEuros(price)}.`);
      } else if (payload.action === "place") this.deps.hud.toast(`Placed: ${name}.`);
      else this.deps.hud.toast(`Put away: ${name} is in your storage.`);
      return;
    }
    if (payload.status === "duplicate") return; // a repeat of a purchase that already went through
    this.deps.hud.toast(FURNISH_FAILURE[payload.status] ?? FURNISH_FAILURE.failed!);
  }

  /** Read-only snapshot for tests. */
  debugState() {
    return { home: this.homeView, storage: this.storageView, panel: this.panel.debugState() };
  }
}
