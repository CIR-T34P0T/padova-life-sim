// Wires rendering, input and networking together. Holds no authoritative
// game state: positions shown here are what the server replicated.

import * as THREE from "three";
import { CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import {
  GAME_CONFIG,
  AREAS,
  PLAZA_AREA,
  PLAZA_LAYOUT,
  findArea,
  isHomeArea,
  type AppearanceConfig,
  type AreaDefinition,
  type HomeView,
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
import { buildWorldScene, type WorldScene } from "./render/worldScene.ts";
import { cameraSpeedFactor } from "./ui/settings.ts";
import { createActionMenu } from "./ui/actionMenu.ts";
import { ActionProgress } from "./ui/actionProgress.ts";
import { CharacterPanel } from "./ui/characterPanel.ts";
import { SocialController } from "./ui/socialController.ts";
import { HousingController } from "./ui/housingController.ts";
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
  /**
   * One scene per area (M7c): the square's detailed art is built just after
   * the title screen appears (defer); an indoor room when first entered.
   */
  private readonly scenes = new Map<string, WorldScene>([[PLAZA_AREA, buildWorldScene(PLAZA_LAYOUT, this.quality, { defer: true })]]);
  /** The area our character is in: the scene drawn and the layout menus use. */
  private areaId = PLAZA_AREA;
  /** Covers the screen for a moment while going through a door. */
  private readonly areaFade = document.createElement("div");
  private readonly rig = new CameraRig(window.innerWidth / window.innerHeight);
  private readonly entities = new Map<string, RemoteEntity>();
  private readonly connection: GameConnection;
  private readonly input: InputController;
  private readonly interactions: InteractionController;
  private readonly characterPanel: CharacterPanel;
  private readonly social: SocialController;
  private readonly housing: HousingController;
  /** Our character is in its home, but the home's data hasn't arrived yet (M10): switch once it has. */
  private pendingArea: string | null = null;
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
  /** The light of the frame that first showed our character after entering, and the clock then (M7b checks). */
  private entryLight: { daylight: ReturnType<WorldScene["stats"]>["daylight"]; gameMinute: number | null } | null = null;

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
      onProfileView: (payload) => this.social.onProfileView(payload),
      onSafety: (payload) => this.social.onSafety(payload),
      onStory: (payload) => this.social.onStory(payload),
      onRelationship: (payload) => this.social.onRelationship(payload),
      onSocialResult: (payload) => this.social.onSocialResult(payload),
      onHousing: (payload) => this.housing.onHousing(payload),
      onFurnishResult: (payload) => this.housing.onFurnishResult(payload),
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
      onQuitJob: () => {
        this.quitRequested = true;
        this.connection.quitJob();
      },
      onUnblock: (blockId) => this.social.unblockById(blockId),
      onFurnish: () => this.housing.openPanel(),
    });
    this.social = new SocialController(overlay, {
      connection: this.connection,
      hud,
      characterPanel: this.characterPanel,
      player: (id) => {
        const latest = this.entities.get(id)?.latest;
        return latest ? { name: latest.name, look: appearanceOf(latest), activity: latest.activity, connected: latest.connected } : undefined;
      },
      closeOthers: () => {
        this.characterPanel.close();
        this.housing.panel.close();
        this.interactions.clearSelection();
      },
      onBlocksChanged: () => this.interactions.onWorldChanged(),
    });
    this.housing = new HousingController(overlay, {
      connection: this.connection,
      hud,
      characterPanel: this.characterPanel,
      life: () => this.life,
      gameMinute: () => this.lastGameMinute,
      closeOthers: () => {
        this.characterPanel.close();
        this.social.card.close();
        this.interactions.clearSelection();
      },
      onHomeChanged: (previous, next) => this.onHomeChanged(previous, next),
    });
    hud.onMeChip(() => {
      this.interactions.clearSelection(); // never two sheets at once
      this.social.card.close();
      this.housing.panel.close();
      this.characterPanel.toggle();
    });
    const menu = createActionMenu(overlay, () => this.interactions.clearSelection());
    const progress = new ActionProgress(overlay, () => this.interactions.cancelCurrentAction());
    this.areaFade.id = "area-fade";
    this.areaFade.setAttribute("aria-hidden", "true");
    overlay.append(this.areaFade);
    const currentHome = () => this.housing.home;
    this.interactions = new InteractionController({
      world: () => this.world,
      layout: () => this.areaDef(this.areaId)?.layout ?? PLAZA_LAYOUT,
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
      onOpenCharacter: () => {
        this.social.card.close();
        this.housing.panel.close();
        this.characterPanel.open();
      },
      onMenuOpen: () => {
        // On touch these are all bottom sheets: the menu takes over.
        if (this.characterPanel.mode === "sheet") this.characterPanel.close();
        if (this.social.card.mode === "sheet") this.social.card.close();
        if (this.housing.panel.mode === "sheet") this.housing.panel.close();
      },
      life: () => this.life,
      social: this.social,
      housing: {
        get home() {
          return currentHome();
        },
        atHome: () => this.atHome(),
        openRent: (doorId) => this.housing.openRent(doorId),
        confirmMoveOut: (doorId) => this.housing.confirmMoveOut(doorId),
        openPanel: () => this.housing.openPanel(),
      },
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
        if (this.social.card.isOpen) this.social.card.close();
        else if (this.housing.panel.isOpen) this.housing.panel.close();
        else if (this.characterPanel.isOpen) this.characterPanel.close();
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

  /** The scene of the area our character is in. */
  private get world(): WorldScene {
    return this.sceneFor(this.areaId);
  }

  /** An area's layout and floor: a fixed one (shared/src/areas.ts), or your home built from the server's data (M10). */
  private areaDef(id: string): AreaDefinition | undefined {
    return isHomeArea(id) ? this.housing.areaFor(id) : findArea(id);
  }

  /** True while our character is in its own home (M10). */
  private atHome(): boolean {
    return isHomeArea(this.areaId) && this.housing.home?.areaId === this.areaId;
  }

  /** The area to draw for a replicated area id; a home whose data hasn't arrived is drawn once it does. */
  private resolveArea(id: string): string {
    if (this.areaDef(id)) return id;
    if (isHomeArea(id)) this.pendingArea = id;
    return PLAZA_AREA;
  }

  private sceneFor(id: string): WorldScene {
    let scene = this.scenes.get(id);
    if (!scene) {
      const area = this.areaDef(id) ?? AREAS[PLAZA_AREA]!;
      scene = buildWorldScene(area.layout, this.quality, area.floor ? { interior: { floor: area.floor } } : {});
      this.scenes.set(id, scene);
    }
    return scene;
  }

  /**
   * Our character went through a door (M7c): draw the other area. Avatars move
   * to its scene; players of the area we left are hidden until the server
   * removes them (it sends only our area's players); a short fade hides the cut.
   */
  private switchArea(next: string): void {
    if (next === this.areaId) return;
    if (!this.areaDef(next)) {
      // Our home's data is on its way (M10): stay put until it arrives.
      if (isHomeArea(next)) this.pendingArea = next;
      return;
    }
    this.pendingArea = null;
    this.interactions.clearSelection();
    this.housing.panel.close();
    this.world.targetMarker.visible = false;
    const previous = this.areaId;
    this.areaId = next;
    const scene = this.world.scene;
    const selfId = this.connection.sessionId;
    for (const [id, entity] of this.entities) {
      if (!entity.view) continue;
      scene.add(entity.view.root);
      if (id !== selfId && entity.latest.area !== next) entity.view.root.visible = false;
    }
    const self = selfId ? this.entities.get(selfId) : undefined;
    if (self) {
      // A jump, not a walk: no interpolation across the two areas.
      self.buffer = new SnapshotBuffer();
      this.pushSnapshot(self, self.latest);
    }
    this.rig.snapToNextTarget();
    this.areaFade.classList.remove("fading");
    this.areaFade.classList.add("shown");
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        this.areaFade.classList.add("fading");
        this.areaFade.classList.remove("shown");
      }),
    );
    // A home is drawn fresh each time it is entered (its furniture may change): free the one we left.
    if (isHomeArea(previous)) this.dropScene(previous);
    this.characterPanel.setAtHome(this.atHome());
    const area = this.areaDef(next);
    this.hud.note(area?.indoor ? area.label : "Back on the square", 2200);
  }

  /** Frees an area's scene that is not being drawn. */
  private dropScene(id: string): void {
    if (id === this.areaId) return;
    this.scenes.get(id)?.dispose();
    this.scenes.delete(id);
  }

  /**
   * Our home changed (M10): rented, moved (also by unpaid rent), given up, or
   * its furniture moved. A changed room we stand in is rebuilt around us; a
   * home we are waiting to enter is entered now.
   */
  private onHomeChanged(previous: HomeView | null, next: HomeView | null): void {
    const sameRoom = previous && next && previous.areaId === next.areaId;
    const changed = sameRoom && JSON.stringify(previous.placements) !== JSON.stringify(next.placements);
    if (previous && this.scenes.has(previous.areaId) && (changed || !sameRoom)) {
      if (this.areaId === previous.areaId && sameRoom) this.rebuildCurrentScene();
      else this.dropScene(previous.areaId);
    }
    if (this.pendingArea && this.areaDef(this.pendingArea)) {
      const area = this.pendingArea;
      this.pendingArea = null;
      if (this.inWorld) this.switchArea(area);
      else this.areaId = area;
    }
    this.characterPanel.setAtHome(this.atHome());
    this.interactions.onWorldChanged();
  }

  /** Redraws the room we stand in (its furniture moved): avatars move to the new scene, the old one is freed. */
  private rebuildCurrentScene(): void {
    const old = this.scenes.get(this.areaId);
    this.scenes.delete(this.areaId);
    const scene = this.world.scene; // builds the new one
    for (const entity of this.entities.values()) if (entity.view) scene.add(entity.view.root);
    old?.dispose();
    this.interactions.clearSelection();
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
    // Saved inside a room: draw that room from the first frame.
    const self = this.connection.sessionId ? this.entities.get(this.connection.sessionId) : undefined;
    if (self?.latest.area) this.areaId = this.resolveArea(self.latest.area);
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
    this.social.card.close();
    this.interactions.clearSelection();
    this.world.targetMarker.visible = false;
    for (const entity of this.entities.values()) {
      entity.view?.dispose();
      entity.view = null;
    }
    this.life = null;
    this.housing.reset();
    this.pendingArea = null;
    if (isHomeArea(this.areaId)) {
      const home = this.areaId;
      this.areaId = PLAZA_AREA;
      this.dropScene(home);
    }
    document.body.classList.remove("in-world");
  }

  /** Name and traits for the character panel, from the saved profile. */
  setProfile(profile: CharacterProfile): void {
    this.characterPanel.setIdentity(profile.displayName, profile.traits);
  }

  /** Set when the player pressed "Quit job"; the server confirms by sending life data without a job. */
  private quitRequested = false;

  private onLife(payload: LifePayload): void {
    if (this.quitRequested && !payload.job) {
      this.quitRequested = false;
      if (this.life?.job) this.hud.toast("You quit your job at the café.", 4500);
    }
    this.life = payload;
    this.hud.setLife(payload);
    this.characterPanel.update(payload);
    this.housing.onLife(payload);
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
    if (selfShown && this.world.isReady() && this.worldVisibleWaiters.length > 0) {
      this.entryLight = { daylight: this.world.stats().daylight, gameMinute: this.lastGameMinute };
      for (const resolve of this.worldVisibleWaiters.splice(0)) resolve();
    }
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
    if (id === this.connection.sessionId && player.area !== this.areaId) {
      if (this.inWorld) this.switchArea(player.area);
      else this.areaId = this.resolveArea(player.area);
    }
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
    if (id === this.connection.sessionId && this.inWorld && player.area !== this.areaId) {
      entity.latest = { ...player };
      this.switchArea(player.area);
      return;
    }
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
    this.social.onPlayerChanged(id);
  }

  private removeEntity(id: string): void {
    const entity = this.entities.get(id);
    if (!entity) return;
    this.interactions.onPlayerRemoved(id);
    this.social.onPlayerRemoved(id);
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
      /** The area drawn: "plaza" or an indoor room's id (M7c). */
      get area() {
        return game.areaId;
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
      /** World art: build time, meshes, triangles, what is faded because it hides your character, and the light shown. */
      worldStats() {
        return game.world.stats();
      },
      /** The light of the first frame that showed our character after entering, with the game minute then (M7b). */
      entryLight() {
        return game.entryLight;
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
      /** Player card, blocks and story (M9). */
      social() {
        return game.social.debugState();
      },
      /** Your home, storage and the furnishing panel (M10). */
      housing() {
        return game.housing.debugState();
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
