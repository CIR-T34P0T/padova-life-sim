// Click/tap-to-interact. Turns taps into a selection (object, other player,
// yourself or ground), shows the contextual menu, sends the chosen action to
// the server and reflects the server's answers. Menu contents come from the
// shared rules applied to replicated state, so the menu shows only actions
// that should be valid; the server still validates every request.

import * as THREE from "three";
import {
  ACTION_LABELS,
  CAFE_MENU,
  COURSES,
  COURSE_IDS,
  HOME_LINK,
  JOBS,
  ROOM_TYPES,
  formatGrade,
  findInteractable,
  findMenuItem,
  findSeat,
  formatEuros,
  formatTimeOfDay,
  gameDayOf,
  gradeFor,
  isTooTired,
  objectActions,
  playerActions,
  shiftRefusal,
  timedEffectFor,
  nextExamSitting,
  type ActionId,
  type WorldLayout,
  type ActionUpdatePayload,
  type ActorView,
  type GreetedPayload,
  type HomeView,
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
import { ACTIVITY_SUBTITLE } from "../ui/activity.ts";
import { examLine, lectureLine, lectureTimetable, whenLabel } from "../ui/university.ts";
import { cheapestRentCents, roomLabel } from "../ui/housing.ts";

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
      /** The scene of the area you are in (changes when you go through a door, M7c). */
      world: () => WorldScene;
      /** The layout of the area you are in. */
      layout: () => WorldLayout;
      camera: () => THREE.Camera;
      canvas: HTMLCanvasElement;
      entities: EntityAccess;
      connection: GameConnection;
      hud: Hud;
      menu: ActionMenu;
      progress: ActionProgress;
      /** Called for a tap on open ground when no menu is open. */
      onGroundTap: (point: { x: number; z: number }) => void;
      /** Called when the player picks "Edit look" on themselves. */
      onEditAppearance: () => void;
      /** Called when the player picks "Character" on themselves. */
      onOpenCharacter: () => void;
      /** Called whenever a contextual menu opens (e.g. to close a conflicting sheet). */
      onMenuOpen: () => void;
      /** The player's latest life data (needs, money), for menu details. */
      life: () => LifePayload | null;
      /** Player cards, blocks and reports (M9). */
      social: {
        isBlocked(playerId: string): boolean;
        openCard(playerId: string): void;
        confirmBlock(playerId: string): void;
        unblockPlayer(playerId: string): void;
        openReport(playerId: string): void;
      };
      /** Your home (M10): what the housing's door offers, the dialogs, the furnishing panel. */
      housing: {
        home: HomeView | null;
        /** True while you are in your own home. */
        atHome(): boolean;
        openRent(doorId: string): void;
        confirmMoveOut(doorId: string): void;
        openPanel(): void;
      };
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
        // Longer than other toasts: these carry the news of a job or a wage.
        if (update.action === "ask_work") hud.toast(this.hiredText(), 4500);
        if (update.action === "work") hud.toast(this.shiftDoneText(), 4500);
        if (update.action === "enrol") hud.toast(this.enrolledText(), 6000);
        if (update.action === "attend") hud.toast(this.lectureDoneText(), 4500);
        if (update.action === "exam") hud.toast(this.examDoneText(), 7000);
        if (update.action === "sleep") hud.toast("You slept and feel rested.");
        if (update.action === "rent") hud.toast(this.rentedText(), 6000);
        if (update.action === "move_out") hud.toast("You moved out. Your furniture is in storage for your next room.", 5000);
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
    // An NPC answering your greeting says something of its own (M11).
    if (payload.line) return this.deps.hud.toast(`${payload.fromName}: “${payload.line}”`, 4000);
    this.deps.hud.toast(payload.action === "chat" ? `${payload.fromName} is chatting with you.` : `${payload.fromName} says "Ciao!"`);
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
    if (choice === "furnish") return this.deps.housing.openPanel();
    if (selection.kind === "self") return;
    // Renting and moving out ask first, in a dialog (M10).
    if (selection.kind === "object" && choice === "rent") return this.deps.housing.openRent(selection.id);
    if (selection.kind === "object" && choice === "move_out") return this.deps.housing.confirmMoveOut(selection.id);
    if (selection.kind === "player") {
      // Card, block and report are requests of their own, not timed actions (M9).
      if (choice === "profile") return this.deps.social.openCard(selection.id);
      if (choice === "block") return this.deps.social.confirmBlock(selection.id);
      if (choice === "unblock") return this.deps.social.unblockPlayer(selection.id);
      if (choice === "report") return this.deps.social.openReport(selection.id);
    }
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
        subtitle: this.deps.housing.atHome() ? "At home" : "You",
        options: [
          { id: "character", label: "Character" },
          { id: "edit-appearance", label: "Edit look" },
          ...(this.deps.housing.atHome() ? [{ id: "furnish", label: "Furnish your room" }] : []),
        ],
      };
    }
    if (selection.kind === "object") {
      const item = findInteractable(this.deps.layout(), selection.id);
      if (!item) return null;
      const options = objectActions(item, actor, this.deps.connection.seats).flatMap((id) =>
        // Doors say where they lead ("Go in", "Go out to the square"), M7c.
        id === "enter" && item.door ? [this.doorOption(item)] : this.optionsFor(id, item),
      );
      // Seated here: clicking yourself lands on this menu, so it also offers your character panel.
      if (item.seats.some((seat) => seat.id === actor.seatId)) options.push({ id: "character", label: "Character" });
      return { title: item.label, subtitle: this.seatSubtitle(item, actor), options };
    }
    const target = this.deps.entities.get(selection.id)?.latest;
    if (!target) return null;
    // A non-player character (M11): greet only; its role says it isn't a player.
    if (target.role) {
      const options = playerActions(actor, { id: selection.id, connected: target.connected, npc: true }).map((id) => ({ id, label: ACTION_LABELS[id] }));
      return { title: target.name, subtitle: `${target.role} · not a player`, options };
    }
    // Someone you blocked offers only their card and Unblock; others greet, chat, card, block, report (M9).
    const options: MenuOption[] = this.deps.social.isBlocked(selection.id)
      ? [
          { id: "profile", label: "Profile" },
          { id: "unblock", label: "Unblock" },
        ]
      : [
          ...playerActions(actor, { id: selection.id, connected: target.connected }).map((id) => ({ id, label: ACTION_LABELS[id] })),
          { id: "profile", label: "Profile" },
          { id: "block", label: "Block…" },
          { id: "report", label: "Report…" },
        ];
    const subtitle = this.deps.social.isBlocked(selection.id) ? "Blocked" : !target.connected ? "Away" : ACTIVITY_SUBTITLE[target.activity];
    return { title: target.name, subtitle, options };
  }

  /** A door's option: where it leads; the student housing's says which room is yours (M10). */
  private doorOption(item: Interactable): MenuOption {
    const home = this.deps.housing.home;
    if (item.door?.to === HOME_LINK && home) return { id: "enter", label: item.door.actionLabel, detail: `Your ${roomLabel(home.roomType).toLowerCase()}` };
    return { id: "enter", label: item.door!.actionLabel };
  }

  /** Menu entries for one action. The café expands into its menu, with prices; the server re-checks everything. */
  private optionsFor(action: ActionId, item?: Interactable): MenuOption[] {
    const life = this.deps.life();
    const home = this.deps.housing.home;
    if (action === "rent") {
      return [home ? { id: action, label: "Change room…", detail: `${roomLabel(home.roomType)} now` } : { id: action, label: ACTION_LABELS.rent, detail: `From ${formatEuros(cheapestRentCents())} a week` }];
    }
    if (action === "move_out") return [{ id: action, label: ACTION_LABELS.move_out }];
    if (action === "sleep") {
      const sleep = timedEffectFor("sleep", item?.furniture);
      const minutes = Math.round((sleep?.durationMs ?? 0) / 60_000);
      return [{ id: action, label: ACTION_LABELS.sleep, detail: `+${sleep?.needs.energy ?? 0} energy · ${minutes} min` }];
    }
    if (action === "ask_work") {
      const wage = life ? gradeFor(JOBS.cafe, skillLevels(life)).wageCents : JOBS.cafe.grades[0]!.wageCents;
      return [{ id: action, label: ACTION_LABELS[action], detail: `${formatEuros(wage)} a shift` }];
    }
    if (action === "work") return [this.workOption(life)];
    if (action === "enrol") return [this.enrolOption(life, item)];
    if (action === "attend" || action === "exam") {
      const line = life ? (action === "attend" ? lectureLine(life) : examLine(life)) : null;
      return [{ id: action, label: ACTION_LABELS[action], ...(line ? { detail: line.text, disabled: line.disabled } : {}) }];
    }
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

  /** "Work a shift" with wage and length, or greyed out with the reason it can't start now. */
  private workOption(life: LifePayload | null): MenuOption {
    const label = ACTION_LABELS.work;
    if (!life?.job) return { id: "work", label };
    const job = JOBS[life.job.jobId];
    // The server's shiftsToday already counts only the current game day.
    const work = { jobId: life.job.jobId, shiftsDay: gameDayOf(life.gameMinute), shiftsToday: life.job.shiftsToday };
    switch (shiftRefusal(work, life.gameMinute, life.needs)) {
      case "closed":
        return { id: "work", label, detail: `Opens at ${formatTimeOfDay(job.opensAt)}`, disabled: true };
      case "shift_limit":
        return { id: "work", label, detail: `${job.maxShiftsPerDay} of ${job.maxShiftsPerDay} shifts done today`, disabled: true };
      case "too_tired":
        return { id: "work", label, detail: "Too tired", disabled: true };
    }
    const wage = gradeFor(job, skillLevels(life)).wageCents;
    return { id: "work", label, detail: `${formatEuros(wage)} · ${Math.round(timedEffectFor("work")!.durationMs / 1000)} s` };
  }

  /** "Enrol" at the notice board: the course and its lectures, or greyed out with the course's status. */
  private enrolOption(life: LifePayload | null, item?: Interactable): MenuOption {
    const course = life?.course;
    if (course?.status === "passed") return { id: "enrol", label: ACTION_LABELS.enrol, detail: `Passed · ${formatGrade(course.finalGrade ?? 0)}`, disabled: true };
    if (course) return { id: "enrol", label: ACTION_LABELS.enrol, detail: "You're enrolled · see your panel", disabled: true };
    const courseId = COURSE_IDS.find((id) => COURSES[id].enrolAt === item?.id);
    if (!courseId) return { id: "enrol", label: ACTION_LABELS.enrol };
    return { id: "enrol", label: `${ACTION_LABELS.enrol}: ${COURSES[courseId].label}`, detail: `Free · lectures ${lectureTimetable(courseId)}` };
  }

  private enrolledText(): string {
    const course = this.deps.life()?.course;
    if (!course) return "You enrolled.";
    const def = COURSES[course.courseId];
    return `You enrolled in ${def.label}. Lectures: ${lectureTimetable(course.courseId)}, in ${def.roomLabel}. Your character panel has the timetable.`;
  }

  private lectureDoneText(): string {
    const course = this.deps.life()?.course;
    if (!course) return "Lecture attended.";
    const full = COURSES[course.courseId].grading.lecturesForFull;
    return `Lecture attended: ${course.lecturesAttended} so far (${full} count in full for the exam).`;
  }

  private examDoneText(): string {
    const life = this.deps.life();
    const result = life?.course?.lastResult;
    if (!life?.course || !result) return "Exam finished.";
    const label = COURSES[life.course.courseId].label;
    if (result.passed) return `Exam passed: ${formatGrade(result.grade)}! You completed ${label}.`;
    const next = nextExamSitting(life.course.courseId, life.gameMinute);
    const retake = next ? ` Retake it at the next sitting (${whenLabel(life.gameMinute, next.opensAt)}).` : "";
    return `Not passed this time: ${formatGrade(result.grade)}. Attend lectures and study, then try again.${retake}`;
  }

  private rentedText(): string {
    const home = this.deps.housing.home;
    if (!home) return "You rented a room.";
    return `Welcome home: your ${roomLabel(home.roomType).toLowerCase()}, ${formatEuros(ROOM_TYPES[home.roomType].rentCents)} a week, taken every Monday. Furnish it from your own menu.`;
  }

  private hiredText(): string {
    const life = this.deps.life();
    const grade = gradeFor(JOBS.cafe, life ? skillLevels(life) : {});
    return `You got the job: ${grade.label}, ${formatEuros(grade.wageCents)} a shift. Work from the café counter.`;
  }

  private shiftDoneText(): string {
    const wage = this.deps.life()?.money.recent.find((entry) => entry.category === "wage");
    return wage ? `Shift done: +${formatEuros(wage.amountCents)} wage.` : "Shift done.";
  }

  private seatSubtitle(item: Interactable, actor: ActorView): string {
    if (item.kind === "cafe") {
      const life = this.deps.life();
      if (!life) return "Café";
      return life.job ? `You have ${formatEuros(life.money.balanceCents)} · you work here` : `You have ${formatEuros(life.money.balanceCents)}`;
    }
    if (item.kind === "fountain") return "Freshen up";
    if (item.kind === "door" && item.door?.to === HOME_LINK) {
      const home = this.deps.housing.home;
      return home ? `You live here · ${roomLabel(home.roomType).toLowerCase()}` : "Rooms to rent";
    }
    if (item.kind === "door") return item.door?.to === "plaza" ? "To the square" : "Door";
    if (item.kind === "bed") return item.seats.some((seat) => seat.id === actor.seatId) ? "You're in bed" : "Your bed";
    if (item.kind === "noticeboard") {
      const course = this.deps.life()?.course;
      if (!course) return "Courses: enrol here";
      return course.status === "passed" ? `${COURSES[course.courseId].label}: passed` : `You're enrolled in ${COURSES[course.courseId].label}`;
    }
    if (item.seats.some((seat) => seat.id === actor.seatId)) return "You're sitting here";
    const free = item.seats.filter((seat) => !this.deps.connection.seats.has(seat.id)).length;
    if (item.seats.length === 1) return free ? "Free" : "Taken";
    return `${free} of ${item.seats.length} seats free`;
  }

  private emptyMenuMessage(selection: NonNullable<Selection>): string {
    if (selection.kind === "object") {
      const item = findInteractable(this.deps.layout(), selection.id);
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
    this.deps.world().highlight(selected, hovered);
  }

  // ── Picking & projection ────────────────────────────────────────────────

  pick(clientX: number, clientY: number): Pick | null {
    const rect = this.deps.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.deps.camera());
    const { entities } = this.deps;
    const world = this.deps.world();
    const hit = this.raycaster.intersectObjects([...world.pickTargets(), ...entities.hitMeshes()], false)[0];
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
      const mesh = this.deps.world().interactableMeshes.get(selection.id);
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
    const life = this.deps.life();
    return {
      id,
      x: self.x,
      z: self.z,
      seatId: self.seatId,
      activity: self.activity,
      job: life?.job?.jobId ?? null,
      course: life?.course ? { courseId: life.course.courseId, status: life.course.status } : null,
      home: this.deps.housing.home ? { roomType: this.deps.housing.home.roomType } : null,
    };
  }

  private selfSeat(): Interactable | null {
    const actor = this.selfActor();
    if (!actor?.seatId) return null;
    return findSeat(this.deps.layout(), actor.seatId)?.interactable ?? null;
  }

  private targetName(kind: TargetKind, id: string): string {
    if (kind === "player") return this.deps.entities.get(id)?.latest.name ?? "them";
    return findInteractable(this.deps.layout(), id)?.label.toLowerCase() ?? "it";
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

/** Skill levels from the owner's life data, for the shared grade rules. */
function skillLevels(life: LifePayload): Record<string, number> {
  return Object.fromEntries(Object.entries(life.skills).map(([skill, view]) => [skill, view.level]));
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
    case "enter":
      return "Going to the door…";
    case "ask_work":
      return "Going to ask about work…";
    case "work":
      return "Going to start a shift…";
    case "chat":
      return `Going to chat with ${targetName}…`;
    case "enrol":
      return "Going to the notice board…";
    case "attend":
      return "Going to the lecture…";
    case "exam":
      return "Going to sit the exam…";
    case "sleep":
      return "Going to bed…";
    case "rent":
    case "move_out":
      return "Going to the student housing…";
    default:
      return `Going to ${ACTION_LABELS[update.action].toLowerCase()}…`;
  }
}

/** Progress text while doing an action. */
function activeText(update: ActionUpdatePayload, targetName: string): string {
  switch (update.action) {
    case "greet":
      return `Greeting ${targetName}`;
    case "chat":
      return `Chatting with ${targetName}`;
    case "study":
      return "Studying";
    case "sketch":
      return "Sketching";
    case "wash":
      return "Washing up";
    case "work":
      return "Working a shift";
    case "ask_work":
      return "Asking about work";
    case "enrol":
      return "Enrolling";
    case "attend":
      return "In the lecture";
    case "exam":
      return "Sitting the exam";
    case "buy": {
      const item = update.itemId ? findMenuItem(update.itemId) : null;
      return item?.activity === "drinking" ? `Drinking ${itemName(update)}` : `Eating ${itemName(update)}`;
    }
    case "sit":
      return "Sitting down";
    case "sleep":
      return "Sleeping";
    case "rent":
      return "Signing for the room";
    case "move_out":
      return "Moving out";
    default:
      return ACTION_LABELS[update.action];
  }
}
