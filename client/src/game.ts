// Wires rendering, input and networking together. Holds no authoritative
// game state: positions shown here are what the server replicated.

import * as THREE from "three";
import { CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import {
  GAME_CONFIG,
  PLAZA_LAYOUT,
  type AppearanceConfig,
  type CharacterProfile,
  type IdentityPayload,
  type LifePayload,
  type JoinOptionsWithIdentity,
  type NewCharacterInput,
  type ProfileErrorPayload,
  type ProfilePayload,
  type RejectedPayload,
} from "@padova/shared";
import { InputController } from "./input/inputController.ts";
import { InteractionController } from "./interaction/interactionController.ts";
import { GameConnection, appearanceOf, type ConnectionStatus, type ReplicatedPlayer } from "./net/connection.ts";
import { SnapshotBuffer } from "./net/interpolation.ts";
import { createAvatar, type AvatarView } from "./render/avatar/index.ts";
import { CameraRig } from "./render/cameraRig.ts";
import { detectQuality } from "./render/quality.ts";
import { buildWorldScene } from "./render/worldScene.ts";
import { cameraSpeedFactor } from "./ui/settings.ts";
import { createActionMenu } from "./ui/actionMenu.ts";
import { ActionProgress } from "./ui/actionProgress.ts";
import { CharacterPanel } from "./ui/characterPanel.ts";
import { Hud } from "./ui/hud.ts";
import { reasonText } from "./ui/reasons.ts";

interface RemoteEntity {
  /** Built only while this client is in the world (no avatar builds behind the title screen). */
  view: AvatarView | null;
  buffer: SnapshotBuffer;
  latest: ReplicatedPlayer;
}

/** Profile events the page (main.ts) reacts to. */
export interface ProfileHandlers {
  onProfile(payload: ProfilePayload): void;
  onIdentity(payload: IdentityPayload): void;
  onProfileError(payload: ProfileErrorPayload): void;
  onDisconnected(code: number | undefined): void;
  onEditAppearance(): void;
  /** The player asked to go back to the title screen (character panel). */
  onLeaveToTitle(): void;
}

/** Minimum time between direction updates sent to the server (ms). */
const DIRECTION_SEND_INTERVAL_MS = 80;

export class Game {
  private readonly quality = detectQuality();
  private readonly renderer: THREE.WebGLRenderer;
  private readonly labelRenderer = new CSS2DRenderer();
  // The detailed district art is built just after the title screen appears (defer).
  private readonly world = buildWorldScene(PLAZA_LAYOUT, this.quality, { defer: true });
  private readonly rig = new CameraRig(window.innerWidth / window.innerHeight);
  private readonly entities = new Map<string, RemoteEntity>();
  private readonly connection: GameConnection;
  private readonly input: InputController;
  private readonly interactions: InteractionController;
  private readonly characterPanel: CharacterPanel;
  private life: LifePayload | null = null;
  private status: ConnectionStatus = "connecting";
  private moveInput = { forward: 0, right: 0 };
  private lastSentDirection = { dx: 0, dz: 0 };
  private lastDirectionSentAt = 0;
  private lastFrame = performance.now();
  /** True between entering the world (server said "ready") and leaving it. */
  private inWorld = false;
  private lastGameMinute: number | null = null;
  /** Every connection status in order (debug hook only). */
  private readonly statusLog: ConnectionStatus[] = [];
  private worldVisibleWaiters: (() => void)[] = [];

  constructor(
    private readonly container: HTMLElement,
    joystick: HTMLElement,
    private readonly hud: Hud,
    private readonly profileHandlers: ProfileHandlers,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: this.quality.antialias, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.quality.maxPixelRatio));
    this.renderer.shadowMap.enabled = this.quality.shadows;
    container.appendChild(this.renderer.domElement);

    this.labelRenderer.domElement.style.position = "absolute";
    this.labelRenderer.domElement.style.inset = "0";
    this.labelRenderer.domElement.style.pointerEvents = "none";
    container.appendChild(this.labelRenderer.domElement);

    this.connection = new GameConnection({
      onStatus: (status, detail, code) => this.onStatus(status, detail, code),
      onPlayerAdded: (id, player) => this.addEntity(id, player),
      onPlayerChanged: (id, player) => this.updateEntity(id, player),
      onPlayerRemoved: (id) => this.removeEntity(id),
      onSeatsChanged: () => this.interactions.onWorldChanged(),
      onRejected: (payload) => this.onRejected(payload),
      onActionUpdate: (payload) => this.interactions.onActionUpdate(payload),
      onGreeted: (payload) => this.interactions.onGreeted(payload),
      onProfile: (payload) => this.profileHandlers.onProfile(payload),
      onIdentity: (payload) => this.profileHandlers.onIdentity(payload),
      onProfileError: (payload) => this.profileHandlers.onProfileError(payload),
      onLife: (payload) => this.onLife(payload),
      onClock: (minute) => {
        this.lastGameMinute = minute;
        this.hud.setClock(minute);
      },
    });

    const overlay = document.body;
    this.characterPanel = new CharacterPanel(overlay, {
      onEditAppearance: () => {
        this.characterPanel.close();
        this.profileHandlers.onEditAppearance();
      },
      onLeaveToTitle: () => {
        this.characterPanel.close();
        this.profileHandlers.onLeaveToTitle();
      },
    });
    hud.onMeChip(() => {
      this.interactions.clearSelection(); // never two sheets at once
      this.characterPanel.toggle();
    });
    const menu = createActionMenu(overlay, () => this.interactions.clearSelection());
    const progress = new ActionProgress(overlay, () => this.interactions.cancelCurrentAction());
    this.interactions = new InteractionController({
      world: this.world,
      camera: () => this.rig.camera,
      canvas: this.renderer.domElement,
      entities: {
        selfId: () => this.connection.sessionId,
        get: (id) => {
          const entity = this.entities.get(id);
          return entity?.view ? { view: entity.view, latest: entity.latest } : undefined;
        },
        hitMeshes: () => [...this.entities.values()].flatMap((entity) => entity.view?.hitMeshes ?? []),
      },
      connection: this.connection,
      hud,
      menu,
      progress,
      onGroundTap: (point) => this.walkTo(point),
      onEditAppearance: () => this.profileHandlers.onEditAppearance(),
      onOpenCharacter: () => this.characterPanel.open(),
      onMenuOpen: () => {
        // On touch both are bottom sheets: the menu takes over.
        if (this.characterPanel.mode === "sheet") this.characterPanel.close();
      },
      life: () => this.life,
    });

    this.input = new InputController(container, joystick, {
      onTap: (x, y) => {
        if (this.status === "connected" && this.playing) this.interactions.handleTap(x, y);
      },
      onHover: (x, y) => {
        if (this.playing) this.interactions.handleHover(x, y);
      },
      onCancel: () => {
        if (!this.playing) return;
        if (this.characterPanel.isOpen) this.characterPanel.close();
        else this.interactions.handleCancel();
      },
      onRotate: (dx, dy) => {
        const speed = cameraSpeedFactor();
        this.rig.rotate(-dx * 0.006 * speed, dy * 0.004 * speed);
      },
      onZoom: (factor) => this.rig.zoom(factor),
      onMoveInput: (forward, right) => {
        // Keys held while a screen covers the world are ignored, not queued.
        this.moveInput = this.playing ? { forward, right } : { forward: 0, right: 0 };
        if (forward !== 0 || right !== 0) this.world.targetMarker.visible = false;
      },
    });

    window.addEventListener("resize", () => this.resize());
    window.visualViewport?.addEventListener("resize", () => this.resize());
    // Closing or navigating away is a deliberate leave: remove the character
    // for everyone now instead of holding it for the reconnection window.
    window.addEventListener("pagehide", () => this.connection.leave());
    this.resize();
  }

  /**
   * Joins the plaza room in the lobby (title screen): the server lists this
   * profile's characters but nobody enters the world yet. Rejects if the
   * server refuses the guest token.
   */
  async connect(options: JoinOptionsWithIdentity): Promise<void> {
    await this.connection.join(options);
    this.exposeDebugHook();
  }

  /** In the world and not hidden behind a full-screen panel. */
  private get playing(): boolean {
    return this.inWorld && !this.covered;
  }

  get isInWorld(): boolean {
    return this.inWorld;
  }

  /** The latest replicated game minute (null before the first clock update). */
  get gameMinute(): number | null {
    return this.lastGameMinute;
  }

  createCharacter(input: NewCharacterInput): void {
    this.connection.createCharacter(input);
  }

  /** In the world: changes the played character. At the title screen: pass the character id. */
  updateAppearance(appearance: AppearanceConfig, characterId?: string): void {
    this.connection.updateAppearance(appearance, characterId);
  }

  enterCharacter(characterId: string): void {
    this.connection.enterWorld(characterId);
  }

  requestLeaveWorld(): void {
    this.connection.leaveWorld();
  }

  deleteCharacter(characterId: string, confirmName: string): void {
    this.connection.deleteCharacter(characterId, confirmName);
  }

  /**
   * The server placed our character in the world: build everyone's avatars
   * and start rendering. Resolves once a frame showing our character has
   * been drawn, so the entry transition can uncover a ready world.
   */
  enterWorld(): Promise<void> {
    const visible = new Promise<void>((resolve) => this.worldVisibleWaiters.push(resolve));
    if (this.inWorld) return visible;
    this.inWorld = true;
    this.moveInput = { forward: 0, right: 0 };
    this.lastSentDirection = { dx: 0, dz: 0 };
    this.rig.snapToNextTarget();
    for (const [id, entity] of this.entities) if (!entity.view) entity.view = this.buildView(id, entity.latest);
    document.body.classList.add("in-world");
    this.lastFrame = performance.now();
    this.renderer.setAnimationLoop(() => this.frame());
    return visible;
  }

  /** Back to the title screen: stop rendering and free the avatars (the server already removed our character). */
  leaveWorld(): void {
    if (!this.inWorld) return;
    this.inWorld = false;
    this.renderer.setAnimationLoop(null);
    this.characterPanel.close();
    this.interactions.clearSelection();
    this.world.targetMarker.visible = false;
    for (const entity of this.entities.values()) {
      entity.view?.dispose();
      entity.view = null;
    }
    this.life = null;
    document.body.classList.remove("in-world");
  }

  /** Name and traits for the character panel, from the saved profile. */
  setProfile(profile: CharacterProfile): void {
    this.characterPanel.setIdentity(profile.displayName, profile.traits);
  }

  private onLife(payload: LifePayload): void {
    this.life = payload;
    this.hud.setLife(payload);
    this.characterPanel.update(payload);
    this.interactions.onWorldChanged(); // e.g. what the player can afford changed
  }

  /** True while a full-screen panel (the character creator) hides the world: skip rendering it. */
  private covered = false;

  setCovered(covered: boolean): void {
    this.covered = covered;
  }

  private frame(): void {
    const now = performance.now();
    const dt = Math.min((now - this.lastFrame) / 1000, 0.1);
    this.lastFrame = now;
    if (this.covered || !this.inWorld) return;

    this.sendDirectionIfChanged(now);

    const renderTime = now - GAME_CONFIG.interpolationDelayMs;
    const selfId = this.connection.sessionId;
    let selfShown = false;
    let selfPose: { x: number; z: number } | null = null;
    for (const [id, entity] of this.entities) {
      const pose = entity.buffer.sample(renderTime);
      if (!pose || !entity.view) continue;
      entity.view.setPose(pose.x, pose.z, pose.rotation, pose.moving, now / 1000);
      if (id === selfId) selfShown = true;
      if (id === selfId) {
        selfPose = { x: pose.x, z: pose.z };
        this.rig.setTarget(pose.x, pose.z);
        if (this.world.targetMarker.visible && !entity.latest.moving) {
          const marker = this.world.targetMarker.position;
          if (Math.hypot(marker.x - pose.x, marker.z - pose.z) < 0.3) this.world.targetMarker.visible = false;
        }
      }
    }

    const t0 = performance.now();
    this.interactions.frame(now);
    this.characterPanel.setCurrentAction(this.interactions.currentActionText());
    this.rig.update(dt);
    const t1 = performance.now();
    this.world.update(this.rig.camera, selfPose, dt, this.lastGameMinute);
    const t2 = performance.now();
    this.renderer.render(this.world.scene, this.rig.camera);
    const t3 = performance.now();
    this.labelRenderer.render(this.world.scene, this.rig.camera);
    const t4 = performance.now();
    this.perf.parts.avatarsMs += (t0 - now - this.perf.parts.avatarsMs) * 0.05;
    this.perf.parts.interactionsMs += (t1 - t0 - this.perf.parts.interactionsMs) * 0.05;
    this.perf.parts.worldMs += (t2 - t1 - this.perf.parts.worldMs) * 0.05;
    this.perf.parts.renderMs += (t3 - t2 - this.perf.parts.renderMs) * 0.05;
    this.perf.parts.labelsMs += (t4 - t3 - this.perf.parts.labelsMs) * 0.05;
    if (selfShown && this.world.isReady() && this.worldVisibleWaiters.length > 0) for (const resolve of this.worldVisibleWaiters.splice(0)) resolve();
    // Rolling averages for the performance readout (debug hook only).
    const cpu = performance.now() - now;
    this.perf.frameCpuMs += (cpu - this.perf.frameCpuMs) * 0.05;
    this.perf.frameIntervalMs += (dt * 1000 - this.perf.frameIntervalMs) * 0.05;
  }

  private readonly perf = {
    frameCpuMs: 0,
    frameIntervalMs: 16.7,
    /** Where the frame's main-thread time goes (rolling averages, ms). */
    parts: { avatarsMs: 0, interactionsMs: 0, worldMs: 0, renderMs: 0, labelsMs: 0 },
  };

  /**
   * Keyboard / joystick input is camera-relative; the server needs a world
   * direction. Re-sent when the input or the camera angle changes enough.
   */
  private sendDirectionIfChanged(now: number): void {
    const { forward, right } = this.moveInput;
    let dx = 0;
    let dz = 0;
    if (forward !== 0 || right !== 0) {
      const axes = this.rig.groundAxes();
      dx = axes.forward.x * forward + axes.right.x * right;
      dz = axes.forward.z * forward + axes.right.z * right;
      const length = Math.hypot(dx, dz);
      if (length > 1) {
        dx /= length;
        dz /= length;
      }
    }
    const changed = Math.hypot(dx - this.lastSentDirection.dx, dz - this.lastSentDirection.dz) > 0.08;
    const stopping = dx === 0 && dz === 0 && (this.lastSentDirection.dx !== 0 || this.lastSentDirection.dz !== 0);
    if (!changed && !stopping) return;
    if (!stopping && now - this.lastDirectionSentAt < DIRECTION_SEND_INTERVAL_MS) return;
    this.connection.moveDirection({ dx, dz });
    this.lastSentDirection = { dx, dz };
    this.lastDirectionSentAt = now;
  }

  private walkTo(target: { x: number; z: number }): void {
    this.connection.moveTo(target);
    this.world.targetMarker.position.set(target.x, 0.03, target.z);
    this.world.targetMarker.visible = true;
  }

  private onRejected(payload: RejectedPayload): void {
    this.world.targetMarker.visible = false;
    this.hud.toast(reasonText(payload.reason));
  }

  private onStatus(status: ConnectionStatus, detail?: string, code?: number): void {
    this.status = status;
    this.statusLog.push(status);
    this.hud.setStatus(status, detail, code);
    if (status === "disconnected") this.profileHandlers.onDisconnected(code);
  }

  private buildView(id: string, player: ReplicatedPlayer): AvatarView {
    const isSelf = id === this.connection.sessionId;
    const view = createAvatar(id, appearanceOf(player), isSelf, this.quality);
    view.setName(player.name);
    view.setAway(!player.connected);
    view.setActivity(player.activity, player.seatId !== "");
    this.world.scene.add(view.root);
    return view;
  }

  private addEntity(id: string, player: ReplicatedPlayer): void {
    if (this.entities.has(id)) return;
    const view = this.inWorld ? this.buildView(id, player) : null;
    const buffer = new SnapshotBuffer();
    const entity: RemoteEntity = { view, buffer, latest: { ...player } };
    this.entities.set(id, entity);
    this.pushSnapshot(entity, player);
    this.hud.setPlayerCount(this.entities.size);
  }

  private updateEntity(id: string, player: ReplicatedPlayer): void {
    const entity = this.entities.get(id);
    if (!entity) return;
    const view = entity.view;
    if (view) {
      if (entity.latest.connected !== player.connected) view.setAway(!player.connected);
      if (entity.latest.name !== player.name) view.setName(player.name);
      if (entity.latest.look !== player.look) view.setAppearance(appearanceOf(player));
      if (entity.latest.activity !== player.activity || entity.latest.seatId !== player.seatId) {
        view.setActivity(player.activity, player.seatId !== "");
      }
    }
    entity.latest = { ...player };
    this.pushSnapshot(entity, player);
    this.interactions.onWorldChanged();
  }

  private removeEntity(id: string): void {
    const entity = this.entities.get(id);
    if (!entity) return;
    this.interactions.onPlayerRemoved(id);
    entity.view?.dispose();
    this.entities.delete(id);
    this.hud.setPlayerCount(this.entities.size);
  }

  private pushSnapshot(entity: RemoteEntity, player: ReplicatedPlayer): void {
    entity.buffer.push({ t: performance.now(), x: player.x, z: player.z, rotation: player.rotation, moving: player.moving });
  }

  private resize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.renderer.setSize(width, height);
    this.labelRenderer.setSize(width, height);
    this.rig.resize(width / height);
  }

  /**
   * Read-only hook for automated browser tests and debugging. Exposed in
   * development builds, or in any build when the URL contains `?e2e`.
   */
  private exposeDebugHook(): void {
    if (!import.meta.env.DEV && !new URLSearchParams(location.search).has("e2e")) return;
    const game = this;
    (window as unknown as { __padova: unknown }).__padova = {
      get status() {
        return game.status;
      },
      get selfId() {
        return game.connection.sessionId;
      },
      get quality() {
        return game.quality.name;
      },
      /** True while our character is in the world (not at the title screen). */
      get inWorld() {
        return game.inWorld;
      },
      /** Every connection status so far, in order. */
      statusLog() {
        return [...game.statusLog];
      },
      /** Closes the connection like a brief network drop (tests of reconnection). */
      simulateDrop() {
        game.connection.simulateDrop();
      },
      /** Camera angle around the player (radians), for tests of camera settings. */
      get cameraYaw() {
        return game.rig.yaw;
      },
      players() {
        return [...game.entities].map(([id, e]) => ({ id, ...e.latest }));
      },
      /** Geometry stats of one player's character (triangles, meshes, last build time). */
      avatarStats(id: string) {
        return game.entities.get(id)?.view?.stats() ?? null;
      },
      /** World art: build time, meshes, triangles, and what is faded because it hides your character. */
      worldStats() {
        return game.world.stats();
      },
      /** Renderer and frame-time numbers (rolling averages; software rendering is not representative). */
      renderStats() {
        const info = game.renderer.info;
        return {
          drawCalls: info.render.calls,
          triangles: info.render.triangles,
          geometries: info.memory.geometries,
          textures: info.memory.textures,
          frameCpuMs: game.perf.frameCpuMs,
          frameIntervalMs: game.perf.frameIntervalMs,
          parts: { ...game.perf.parts },
        };
      },
      /** Selection, open menu, progress text and current action. */
      interaction() {
        return game.interactions.debugState();
      },
      /** The player's latest life data from the server (needs, mood, skills, money). */
      life() {
        return game.life;
      },
      /** Character panel: open, layout mode and visible text. */
      characterPanel() {
        return game.characterPanel.debugState();
      },
      /** Replicated seat occupancy as [seatId, playerId] pairs. */
      seats() {
        const entries: [string, string][] = [];
        (game.connection.seats as unknown as { forEach(cb: (v: string, k: string) => void): void }).forEach((v, k) => entries.push([k, v]));
        return entries;
      },
      /** Screen point above an interactable object or a player, for tests that tap targets. */
      targetScreenPoint(kind: "object" | "player", id: string) {
        return game.interactions.anchorFor({ kind, id });
      },
      /** What a tap at this screen point would select (no side effects). */
      pickAt(x: number, y: number) {
        return game.interactions.pick(x, y);
      },
      /** Screen coordinates of a ground point, for tests that tap the world. */
      worldToScreen(x: number, z: number) {
        const v = new THREE.Vector3(x, 0, z).project(game.rig.camera);
        const rect = game.renderer.domElement.getBoundingClientRect();
        return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
      },
    };
  }
}
