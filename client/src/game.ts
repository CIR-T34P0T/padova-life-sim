// Wires rendering, input and networking together. Holds no authoritative
// game state: positions shown here are what the server replicated.

import * as THREE from "three";
import { CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { GAME_CONFIG, PLAZA_LAYOUT, type RejectedPayload } from "@padova/shared";
import { InputController } from "./input/inputController.ts";
import { InteractionController } from "./interaction/interactionController.ts";
import { GameConnection, type ConnectionStatus, type ReplicatedPlayer } from "./net/connection.ts";
import { SnapshotBuffer } from "./net/interpolation.ts";
import { createAvatar, type AvatarView } from "./render/avatars.ts";
import { CameraRig } from "./render/cameraRig.ts";
import { detectQuality } from "./render/quality.ts";
import { buildWorldScene } from "./render/worldScene.ts";
import { createActionMenu } from "./ui/actionMenu.ts";
import { ActionProgress } from "./ui/actionProgress.ts";
import { Hud } from "./ui/hud.ts";
import { reasonText } from "./ui/reasons.ts";

interface RemoteEntity {
  view: AvatarView;
  buffer: SnapshotBuffer;
  latest: ReplicatedPlayer;
}

/** Minimum time between direction updates sent to the server (ms). */
const DIRECTION_SEND_INTERVAL_MS = 80;

export class Game {
  private readonly quality = detectQuality();
  private readonly renderer: THREE.WebGLRenderer;
  private readonly labelRenderer = new CSS2DRenderer();
  private readonly world = buildWorldScene(PLAZA_LAYOUT, this.quality);
  private readonly rig = new CameraRig(window.innerWidth / window.innerHeight);
  private readonly entities = new Map<string, RemoteEntity>();
  private readonly connection: GameConnection;
  private readonly input: InputController;
  private readonly interactions: InteractionController;
  private status: ConnectionStatus = "connecting";
  private moveInput = { forward: 0, right: 0 };
  private lastSentDirection = { dx: 0, dz: 0 };
  private lastDirectionSentAt = 0;
  private lastFrame = performance.now();

  constructor(
    private readonly container: HTMLElement,
    joystick: HTMLElement,
    private readonly hud: Hud,
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
      onStatus: (status, detail) => this.onStatus(status, detail),
      onPlayerAdded: (id, player) => this.addEntity(id, player),
      onPlayerChanged: (id, player) => this.updateEntity(id, player),
      onPlayerRemoved: (id) => this.removeEntity(id),
      onSeatsChanged: () => this.interactions.onWorldChanged(),
      onRejected: (payload) => this.onRejected(payload),
      onActionUpdate: (payload) => this.interactions.onActionUpdate(payload),
      onGreeted: (payload) => this.interactions.onGreeted(payload),
    });

    const overlay = document.body;
    const menu = createActionMenu(overlay, () => this.interactions.clearSelection());
    const progress = new ActionProgress(overlay, () => this.interactions.cancelCurrentAction());
    this.interactions = new InteractionController({
      world: this.world,
      camera: () => this.rig.camera,
      canvas: this.renderer.domElement,
      entities: {
        selfId: () => this.connection.sessionId,
        get: (id) => this.entities.get(id),
        hitMeshes: () => [...this.entities.values()].map((entity) => entity.view.hitMesh),
      },
      connection: this.connection,
      hud,
      menu,
      progress,
      onGroundTap: (point) => this.walkTo(point),
    });

    this.input = new InputController(container, joystick, {
      onTap: (x, y) => {
        if (this.status === "connected") this.interactions.handleTap(x, y);
      },
      onHover: (x, y) => this.interactions.handleHover(x, y),
      onCancel: () => this.interactions.handleCancel(),
      onRotate: (dx, dy) => this.rig.rotate(-dx * 0.006, dy * 0.004),
      onZoom: (factor) => this.rig.zoom(factor),
      onMoveInput: (forward, right) => {
        this.moveInput = { forward, right };
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

  async start(name: string): Promise<void> {
    await this.connection.join({ name });
    this.renderer.setAnimationLoop(() => this.frame());
    this.exposeDebugHook();
  }

  private frame(): void {
    const now = performance.now();
    const dt = Math.min((now - this.lastFrame) / 1000, 0.1);
    this.lastFrame = now;

    this.sendDirectionIfChanged(now);

    const renderTime = now - GAME_CONFIG.interpolationDelayMs;
    const selfId = this.connection.sessionId;
    for (const [id, entity] of this.entities) {
      const pose = entity.buffer.sample(renderTime);
      if (!pose) continue;
      entity.view.setPose(pose.x, pose.z, pose.rotation, pose.moving, now / 1000);
      if (id === selfId) {
        this.rig.setTarget(pose.x, pose.z);
        if (this.world.targetMarker.visible && !entity.latest.moving) {
          const marker = this.world.targetMarker.position;
          if (Math.hypot(marker.x - pose.x, marker.z - pose.z) < 0.3) this.world.targetMarker.visible = false;
        }
      }
    }

    this.interactions.frame(now);
    this.rig.update(dt);
    this.renderer.render(this.world.scene, this.rig.camera);
    this.labelRenderer.render(this.world.scene, this.rig.camera);
  }

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

  private onStatus(status: ConnectionStatus, detail?: string): void {
    this.status = status;
    this.hud.setStatus(status, detail);
  }

  private addEntity(id: string, player: ReplicatedPlayer): void {
    if (this.entities.has(id)) return;
    const isSelf = id === this.connection.sessionId;
    const view = createAvatar(id, player.hue, isSelf, this.quality);
    view.setName(player.name);
    view.setAway(!player.connected);
    view.setActivity(player.activity, player.seatId !== "");
    this.world.scene.add(view.root);
    const buffer = new SnapshotBuffer();
    const entity: RemoteEntity = { view, buffer, latest: { ...player } };
    this.entities.set(id, entity);
    this.pushSnapshot(entity, player);
    this.hud.setPlayerCount(this.entities.size);
  }

  private updateEntity(id: string, player: ReplicatedPlayer): void {
    const entity = this.entities.get(id);
    if (!entity) return;
    if (entity.latest.connected !== player.connected) entity.view.setAway(!player.connected);
    if (entity.latest.name !== player.name) entity.view.setName(player.name);
    if (entity.latest.activity !== player.activity || entity.latest.seatId !== player.seatId) {
      entity.view.setActivity(player.activity, player.seatId !== "");
    }
    entity.latest = { ...player };
    this.pushSnapshot(entity, player);
    this.interactions.onWorldChanged();
  }

  private removeEntity(id: string): void {
    const entity = this.entities.get(id);
    if (!entity) return;
    this.interactions.onPlayerRemoved(id);
    entity.view.dispose();
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
      players() {
        return [...game.entities].map(([id, e]) => ({ id, ...e.latest }));
      },
      /** Selection, open menu, progress text and current action. */
      interaction() {
        return game.interactions.debugState();
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
