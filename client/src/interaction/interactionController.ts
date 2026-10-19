// Click/tap-to-interact. Turns taps into a selection (object, other player,
// yourself or ground), shows the contextual menu, sends the chosen action to
// the server and reflects the server's answers. Menu contents come from the
// shared rules applied to replicated state, so the menu shows only actions
// that should be valid; the server still validates every request.

import * as THREE from "three";
import {
  ACTION_LABELS,
  CAFE_MENU,
  PLAZA_LAYOUT,
  findInteractable,
  findMenuItem,
  findSeat,
  formatEuros,
  isTooTired,
  objectActions,
  playerActions,
  timedEffectFor,
  type ActionId,
  type ActionUpdatePayload,
  type ActorView,
  type GreetedPayload,
  type Interactable,
  type LifePayload,
  type TargetKind,
} from "@padova/shared";
import type { GameConnection, ReplicatedPlayer } from "../net/connection.ts";
import type { AvatarView } from "../render/avatar/index.ts";
import type { WorldScene } from "../render/worldScene.ts";
import type { ActionMenu, MenuChoice, MenuOption, MenuSpec } from "../ui/actionMenu.ts";
import type { ActionProgress } from "../ui/actionProgress.ts";
import type { Hud } from "../ui/hud.ts";
import { reasonText } from "../ui/reasons.ts";

export interface EntityAccess {
  selfId(): string | null;
  get(id: string): { view: AvatarView; latest: ReplicatedPlayer } | undefined;
  hitMeshes(): THREE.Object3D[];
}

export type Pick =
  | { kind: "object"; id: string }
  | { kind: "player"; id: string }
  | { kind: "self" }
  | { kind: "ground"; point: { x: number; z: number } }
  | { kind: "blocked"; label?: string };

/** "self" = the local player; its menu holds client-side options such as editing appearance. */
type Selection = { kind: TargetKind | "self"; id: string } | null;

function sameMenu(a: MenuSpec | null, b: MenuSpec): boolean {
  return (
    a !== null &&
    a.title === b.title &&
    a.subtitle === b.subtitle &&
    a.options.length === b.options.length &&
    a.options.every((option, i) => {
      const other = b.options[i];
      return option.id === other?.id && option.detail === other.detail && option.disabled === other.disabled;
    })
  );
}

const ACTIVITY_SUBTITLE: Record<string, string> = {
  sitting: "Sitting",
  studying: "Studying",
  sketching: "Sketching",
  greeting: "Greeting someone",
  ordering: "Ordering",
  eating: "Eating",
  drinking: "Having a coffee",
  washing: "Washing up",
};

/** Idempotency id for purchases. Uses getRandomValues, which works on plain-http LAN pages too. */
function newRequestId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `c-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export class InteractionController {
  private readonly raycaster = new THREE.Raycaster();
  private selection: Selection = null;
  private hovered: Selection = null;
  private pendingHover: { x: number; y: number } | null = null;
  private currentActionId = 0;
  private currentAction: ActionUpdatePayload | null = null;

  constructor(
    private readonly deps: {
      world: WorldScene;
      camera: () => THREE.Camera;
      canvas: HTMLCanvasElement;
      entities: EntityAccess;
      connection: GameConnection;
      hud: Hud;
      menu: ActionMenu;
      progress: ActionProgress;
      /** Called for a tap on open ground when no menu is open. */
      onGroundTap: (point: { x: number; z: number }) => void;
      /** Called when the player picks "Edit appearance" on themselves. */
      onEditAppearance: () => void;
      /** Called when the player picks "Character" on themselves. */
      onOpenCharacter: () => void;
      /** Called whenever a contextual menu opens (e.g. to close a conflicting sheet). */
      onMenuOpen: () => void;
      /** The player's latest life data (needs, money), for menu details. */
      life: () => LifePayload | null;
    },
  ) {}

  // ── Input ───────────────────────────────────────────────────────────────

  handleTap(clientX: number, clientY: number): void {
    const pick = this.pick(clientX, clientY);
    if (!pick) return;
    switch (pick.kind) {
      case "object":
        this.select({ kind: "object", id: pick.id });
        return;
      case "player":
        this.select({ kind: "player", id: pick.id });
        return;
      case "self": {
        // Seated: what you can do where you sit. Standing: your own options.
        const seated = this.selfSeat();
        const selfId = this.deps.entities.selfId();
        if (seated) this.select({ kind: "object", id: seated.id });
        else if (selfId) this.select({ kind: "self", id: selfId });
        return;
      }
      case "blocked":
        if (this.menuOrSelectionOpen()) return this.clearSelection();
        this.deps.hud.toast(pick.label ? `${pick.label}: you can't walk there.` : "You can't walk there.");
        return;
      case "ground":
        // With a menu open, a tap elsewhere only dismisses it.
        if (this.menuOrSelectionOpen()) return this.clearSelection();
        this.deps.onGroundTap(pick.point);
    }
  }

  handleHover(clientX: number | null, clientY: number | null): void {
    this.pendingHover = clientX === null || clientY === null ? null : { x: clientX, y: clientY };
    if (!this.pendingHover) this.setHovered(null);
  }

  /** Escape: close the menu if open, otherwise cancel the current action. */
  handleCancel(): void {
    if (this.menuOrSelectionOpen()) return this.clearSelection();
    if (this.currentAction) this.deps.connection.cancelAction();
  }

  cancelCurrentAction(): void {
    this.deps.connection.cancelAction();
  }

  /** What the player is doing right now, in words (for the character panel). */
  currentActionText(): string | null {
    const update = this.currentAction;
    if (!update) return null;
    const name = this.targetName(update.targetKind, update.targetId);
    return update.status === "queued" ? queuedText(update, name) : activeText(update, name);
  }

  // ── Server events ───────────────────────────────────────────────────────

  onActionUpdate(update: ActionUpdatePayload): void {
    const { progress, hud } = this.deps;
    if (update.status === "rejected") {
      // A refused request never replaced the running action, so leave its progress alone.
      hud.toast(reasonText(update.reason));
      return;
    }
    if (update.actionId < this.currentActionId) return; // stale message about an older action
    this.currentActionId = update.actionId;
    const name = this.targetName(update.targetKind, update.targetId);

    switch (update.status) {
      case "queued":
        this.currentAction = update;
        progress.showIndefinite(queuedText(update, name));
        return;
      case "started":
        this.currentAction = update;
        if (update.durationMs && update.durationMs > 0) progress.showTimed(activeText(update, name), update.durationMs);
        else progress.showIndefinite(activeText(update, name));
        return;
      case "completed":
        this.currentAction = null;
        progress.hide();
        if (update.action === "study") hud.toast("Study session complete.");
        if (update.action === "sketch") hud.toast("Sketch finished.");
        return;
      case "failed":
        this.currentAction = null;
        progress.hide();
        hud.toast(reasonText(update.reason));
        return;
      case "cancelled":
        this.currentAction = null;
        progress.hide();
    }
  }

  onGreeted(payload: GreetedPayload): void {
    this.deps.hud.toast(`${payload.fromName} says "Ciao!"`);
  }

  /** Replicated state changed (players or seats): keep an open menu truthful. */
  onWorldChanged(): void {
    if (!this.selection) return;
    const spec = this.buildMenu(this.selection);
    if (!spec || spec.options.length === 0) {
      this.clearSelection();
      return;
    }
    // Positions change many times a second; only re-render when the menu's
    // contents changed, so buttons are never replaced under the pointer.
    if (this.deps.menu.isOpen && !sameMenu(this.deps.menu.current, spec)) this.deps.menu.update(spec);
  }

  onPlayerRemoved(id: string): void {
    if (this.selection?.kind === "player" && this.selection.id === id) this.clearSelection();
    if (this.hovered?.kind === "player" && this.hovered.id === id) this.hovered = null;
  }

  // ── Per frame ───────────────────────────────────────────────────────────

  frame(now: number): void {
    this.deps.progress.frame(now);
    if (this.pendingHover) {
      const { x, y } = this.pendingHover;
      this.pendingHover = null;
      const pick = this.pick(x, y);
      if (pick?.kind === "object") this.setHovered({ kind: "object", id: pick.id });
      else if (pick?.kind === "player") this.setHovered({ kind: "player", id: pick.id });
      else this.setHovered(null);
    }
    if (this.selection && this.deps.menu.isOpen) {
      const anchor = this.anchorFor(this.selection);
      if (anchor) this.deps.menu.setAnchor(anchor.x, anchor.y, anchor.visible);
    }
  }

  // ── Selection & menus ───────────────────────────────────────────────────

  private select(selection: NonNullable<Selection>): void {
    const spec = this.buildMenu(selection);
    if (!spec || spec.options.length === 0) {
      this.clearSelection();
      this.deps.hud.toast(this.emptyMenuMessage(selection));
      return;
    }
    this.setSelection(selection);
    this.deps.onMenuOpen();
    this.deps.menu.open(spec, (action) => this.choose(selection, action));
    const anchor = this.anchorFor(selection);
    if (anchor) this.deps.menu.setAnchor(anchor.x, anchor.y, anchor.visible);
  }

  private choose(selection: NonNullable<Selection>, choice: MenuChoice): void {
    this.setSelection(null);
    if (choice === "edit-appearance") return this.deps.onEditAppearance();
    if (choice === "character") return this.deps.onOpenCharacter();
    if (selection.kind === "self") return;
    if (choice.startsWith("buy:")) {
      const itemId = choice.slice(4);
      this.deps.connection.interact({ targetKind: selection.kind, targetId: selection.id, action: "buy", itemId, requestId: newRequestId() });
      return;
    }
    this.deps.connection.interact({ targetKind: selection.kind, targetId: selection.id, action: choice as ActionId });
  }

  clearSelection(): void {
    this.deps.menu.close();
    this.setSelection(null);
  }

  private menuOrSelectionOpen(): boolean {
    return this.deps.menu.isOpen || this.selection !== null;
  }

  private buildMenu(selection: NonNullable<Selection>): MenuSpec | null {
    const actor = this.selfActor();
    if (!actor) return null;
    if (selection.kind === "self") {
      const self = this.deps.entities.get(selection.id)?.latest;
      return {
        title: self ? self.name : "You",
        subtitle: "You",
        options: [
          { id: "character", label: "Character" },
          { id: "edit-appearance", label: "Edit appearance" },
        ],
      };
    }
    if (selection.kind === "object") {
      const item = findInteractable(PLAZA_LAYOUT, selection.id);
      if (!item) return null;
      const options = objectActions(item, actor, this.deps.connection.seats).flatMap((id) => this.optionsFor(id));
      // Seated here: clicking yourself lands on this menu, so it also offers your character panel.
      if (item.seats.some((seat) => seat.id === actor.seatId)) options.push({ id: "character", label: "Character" });
      return { title: item.label, subtitle: this.seatSubtitle(item, actor), options };
    }
    const target = this.deps.entities.get(selection.id)?.latest;
    if (!target) return null;
    const options = playerActions(actor, { id: selection.id, connected: target.connected }).map((id) => ({
      id,
      label: ACTION_LABELS[id],
    }));
    const subtitle = !target.connected ? "Away" : ACTIVITY_SUBTITLE[target.activity];
    return { title: target.name, subtitle, options };
  }

  /** Menu entries for one action. The café expands into its menu, with prices; the server re-checks everything. */
  private optionsFor(action: ActionId): MenuOption[] {
    const life = this.deps.life();
    if (action === "buy") {
      return CAFE_MENU.map((item) => {
        const short = life !== null && life.money.balanceCents < item.priceCents;
        return {
          id: `buy:${item.id}`,
          label: item.label,
          detail: short ? `${formatEuros(item.priceCents)} · not enough money` : formatEuros(item.priceCents),
          disabled: short,
        };
      });
    }
    const effect = timedEffectFor(action);
    if (effect?.focus && life && isTooTired(life.needs)) {
      return [{ id: action, label: ACTION_LABELS[action], detail: "Too tired", disabled: true }];
    }
    return [{ id: action, label: ACTION_LABELS[action] }];
  }

  private seatSubtitle(item: Interactable, actor: ActorView): string {
    if (item.kind === "cafe") {
      const life = this.deps.life();
      return life ? `You have ${formatEuros(life.money.balanceCents)}` : "Café";
    }
    if (item.kind === "fountain") return "Freshen up";
    if (item.seats.some((seat) => seat.id === actor.seatId)) return "You're sitting here";
    const free = item.seats.filter((seat) => !this.deps.connection.seats.has(seat.id)).length;
    if (item.seats.length === 1) return free ? "Free" : "Taken";
    return `${free} of ${item.seats.length} seats free`;
  }

  private emptyMenuMessage(selection: NonNullable<Selection>): string {
    if (selection.kind === "object") {
      const item = findInteractable(PLAZA_LAYOUT, selection.id);
      return reasonText(item && item.seats[0]?.pose === "stand" ? "busy" : "no_free_seat");
    }
    if (selection.kind === "self") return reasonText("action_not_available");
    const target = this.deps.entities.get(selection.id)?.latest;
    return target && !target.connected ? reasonText("target_offline") : reasonText("action_not_available");
  }

  private setSelection(selection: Selection): void {
    const previous = this.selection;
    if (previous?.kind === "player") this.deps.entities.get(previous.id)?.view.setSelected(false);
    this.selection = selection;
    if (selection?.kind === "player") this.deps.entities.get(selection.id)?.view.setSelected(true);
    this.refreshObjectHighlight();
  }

  private setHovered(hovered: Selection): void {
    const previous = this.hovered;
    if (previous?.kind === hovered?.kind && previous?.id === hovered?.id) return;
    if (previous?.kind === "player") this.deps.entities.get(previous.id)?.view.setHovered(false);
    this.hovered = hovered;
    if (hovered?.kind === "player") this.deps.entities.get(hovered.id)?.view.setHovered(true);
    this.deps.canvas.style.cursor = hovered ? "pointer" : "";
    this.refreshObjectHighlight();
  }

  private refreshObjectHighlight(): void {
    const selected = this.selection?.kind === "object" ? this.selection.id : null;
    const hovered = this.hovered?.kind === "object" ? this.hovered.id : null;
    this.deps.world.highlight(selected, hovered);
  }

  // ── Picking & projection ────────────────────────────────────────────────

  pick(clientX: number, clientY: number): Pick | null {
    const rect = this.deps.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.deps.camera());
    const { world, entities } = this.deps;
    const hit = this.raycaster.intersectObjects([world.ground, ...world.blockers, ...entities.hitMeshes()], false)[0];
    if (!hit) return null;
    const playerId = hit.object.userData.playerId as string | undefined;
    if (playerId) return playerId === entities.selfId() ? { kind: "self" } : { kind: "player", id: playerId };
    const interactableId = hit.object.userData.interactableId as string | undefined;
    if (interactableId) return { kind: "object", id: interactableId };
    if (hit.object === world.ground) return { kind: "ground", point: { x: hit.point.x, z: hit.point.z } };
    return { kind: "blocked", label: hit.object.userData.label as string | undefined };
  }

  /** Screen point above a target, for anchoring the radial menu and for tests. */
  anchorFor(selection: { kind: TargetKind | "self"; id: string }): { x: number; y: number; visible: boolean } | null {
    const position = new THREE.Vector3();
    if (selection.kind === "object") {
      const mesh = this.deps.world.interactableMeshes.get(selection.id);
      if (!mesh) return null;
      position.set(mesh.position.x, mesh.position.y + mesh.scale.y / 2, mesh.position.z);
    } else {
      const entity = this.deps.entities.get(selection.id);
      if (!entity) return null;
      entity.view.anchor.getWorldPosition(position);
    }
    return this.project(position);
  }

  project(position: THREE.Vector3): { x: number; y: number; visible: boolean } {
    const projected = position.clone().project(this.deps.camera());
    const rect = this.deps.canvas.getBoundingClientRect();
    const x = rect.left + ((projected.x + 1) / 2) * rect.width;
    const y = rect.top + ((1 - projected.y) / 2) * rect.height;
    const visible = projected.z < 1 && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    return { x, y, visible };
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private selfActor(): ActorView | null {
    const id = this.deps.entities.selfId();
    const self = id ? this.deps.entities.get(id)?.latest : undefined;
    if (!id || !self) return null;
    return { id, x: self.x, z: self.z, seatId: self.seatId, activity: self.activity };
  }

  private selfSeat(): Interactable | null {
    const actor = this.selfActor();
    if (!actor?.seatId) return null;
    return findSeat(PLAZA_LAYOUT, actor.seatId)?.interactable ?? null;
  }

  private targetName(kind: TargetKind, id: string): string {
    if (kind === "player") return this.deps.entities.get(id)?.latest.name ?? "them";
    return findInteractable(PLAZA_LAYOUT, id)?.label.toLowerCase() ?? "it";
  }

  /** Read-only snapshot for tests and debugging. */
  debugState() {
    return {
      selection: this.selection,
      menu: this.deps.menu.isOpen
        ? {
            kind: this.deps.menu.kind,
            title: this.deps.menu.current?.title ?? "",
            subtitle: this.deps.menu.current?.subtitle ?? "",
            options: this.deps.menu.current?.options.map((o) => o.label) ?? [],
            details: this.deps.menu.current?.options.map((o) => o.detail ?? "") ?? [],
            disabled: this.deps.menu.current?.options.map((o) => Boolean(o.disabled)) ?? [],
          }
        : null,
      progress: this.deps.progress.text,
      currentAction: this.currentAction ? { action: this.currentAction.action, status: this.currentAction.status } : null,
    };
  }
}

function itemName(update: ActionUpdatePayload): string {
  const item = update.itemId ? findMenuItem(update.itemId) : null;
  if (!item) return "something";
  return `${/^[aeiou]/i.test(item.label) ? "an" : "a"} ${item.label.toLowerCase()}`;
}

/** Progress text while walking to an action. */
function queuedText(update: ActionUpdatePayload, targetName: string): string {
  switch (update.action) {
    case "greet":
      return `Going to greet ${targetName}…`;
    case "buy":
      return `Going to buy ${itemName(update)}…`;
    case "wash":
      return "Going to wash up…";
    default:
      return `Going to ${ACTION_LABELS[update.action].toLowerCase()}…`;
  }
}

/** Progress text while doing an action. */
function activeText(update: ActionUpdatePayload, targetName: string): string {
  switch (update.action) {
    case "greet":
      return `Greeting ${targetName}`;
    case "study":
      return "Studying";
    case "sketch":
      return "Sketching";
    case "wash":
      return "Washing up";
    case "buy": {
      const item = update.itemId ? findMenuItem(update.itemId) : null;
      return item?.activity === "drinking" ? `Drinking ${itemName(update)}` : `Eating ${itemName(update)}`;
    }
    case "sit":
      return "Sitting down";
    default:
      return ACTION_LABELS[update.action];
  }
}
