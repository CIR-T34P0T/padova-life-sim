// Click/tap-to-interact. Turns taps into a selection (object, other player,
// yourself or ground), shows the contextual menu, sends the chosen action to
// the server and reflects the server's answers. Menu contents come from the
// shared rules applied to replicated state, so the menu shows only actions
// that should be valid; the server still validates every request.

import * as THREE from "three";
import {
  ACTION_LABELS,
  PLAZA_LAYOUT,
  findInteractable,
  findSeat,
  objectActions,
  playerActions,
  type ActionId,
  type ActionUpdatePayload,
  type ActorView,
  type GreetedPayload,
  type Interactable,
  type TargetKind,
} from "@padova/shared";
import type { GameConnection, ReplicatedPlayer } from "../net/connection.ts";
import type { AvatarView } from "../render/avatars.ts";
import type { WorldScene } from "../render/worldScene.ts";
import type { ActionMenu, MenuSpec } from "../ui/actionMenu.ts";
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

type Selection = { kind: TargetKind; id: string } | null;

function sameMenu(a: MenuSpec | null, b: MenuSpec): boolean {
  return (
    a !== null &&
    a.title === b.title &&
    a.subtitle === b.subtitle &&
    a.options.length === b.options.length &&
    a.options.every((option, i) => option.id === b.options[i]?.id)
  );
}

const ACTIVITY_SUBTITLE: Record<string, string> = {
  sitting: "Sitting",
  studying: "Studying",
  greeting: "Greeting someone",
};

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
        // Tapping yourself while seated offers what you can do where you sit.
        const seated = this.selfSeat();
        if (seated) this.select({ kind: "object", id: seated.id });
        else this.clearSelection();
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
        progress.showIndefinite(update.action === "greet" ? `Going to greet ${name}…` : `Going to ${ACTION_LABELS[update.action].toLowerCase()}…`);
        return;
      case "started":
        this.currentAction = update;
        if (update.durationMs && update.durationMs > 0) {
          progress.showTimed(update.action === "greet" ? `Greeting ${name}` : "Studying", update.durationMs);
        } else {
          progress.showIndefinite(update.action === "sit" ? "Sitting down" : ACTION_LABELS[update.action]);
        }
        return;
      case "completed":
        this.currentAction = null;
        progress.hide();
        if (update.action === "study") hud.toast("Study session complete.");
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
    this.deps.menu.open(spec, (action) => this.choose(selection, action));
    const anchor = this.anchorFor(selection);
    if (anchor) this.deps.menu.setAnchor(anchor.x, anchor.y, anchor.visible);
  }

  private choose(selection: NonNullable<Selection>, action: ActionId): void {
    this.deps.connection.interact({ targetKind: selection.kind, targetId: selection.id, action });
    this.setSelection(null);
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
    if (selection.kind === "object") {
      const item = findInteractable(PLAZA_LAYOUT, selection.id);
      if (!item) return null;
      const options = objectActions(item, actor, this.deps.connection.seats).map((id) => ({ id, label: ACTION_LABELS[id] }));
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

  private seatSubtitle(item: Interactable, actor: ActorView): string {
    if (item.seats.some((seat) => seat.id === actor.seatId)) return "You're sitting here";
    const free = item.seats.filter((seat) => !this.deps.connection.seats.has(seat.id)).length;
    if (item.seats.length === 1) return free ? "Free" : "Taken";
    return `${free} of ${item.seats.length} seats free`;
  }

  private emptyMenuMessage(selection: NonNullable<Selection>): string {
    if (selection.kind === "object") return reasonText("no_free_seat");
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
  anchorFor(selection: NonNullable<Selection>): { x: number; y: number; visible: boolean } | null {
    const position = new THREE.Vector3();
    if (selection.kind === "object") {
      const mesh = this.deps.world.interactableMeshes.get(selection.id);
      if (!mesh) return null;
      position.set(mesh.position.x, mesh.position.y + mesh.scale.y / 2, mesh.position.z);
    } else {
      const entity = this.deps.entities.get(selection.id);
      if (!entity) return null;
      entity.view.hitMesh.getWorldPosition(position);
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
          }
        : null,
      progress: this.deps.progress.text,
      currentAction: this.currentAction ? { action: this.currentAction.action, status: this.currentAction.status } : null,
    };
  }
}
