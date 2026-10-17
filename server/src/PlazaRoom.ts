import { Room, type Client } from "@colyseus/core";
import {
  ClientMessage,
  GAME_CONFIG,
  NavGrid,
  PLAZA_LAYOUT,
  ServerMessage,
  isPositionWalkable,
  parseMoveDirection,
  parseMoveTo,
  sanitizeDisplayName,
  stepCharacter,
  type JoinOptions,
  type MovingCharacter,
  type RejectedPayload,
} from "@padova/shared";
import { log } from "./log.ts";
import { PlayerState, PlazaState } from "./schema.ts";

const world = PLAZA_LAYOUT;
const navGrid = new NavGrid(world, GAME_CONFIG.navCellSize, GAME_CONFIG.playerRadius, GAME_CONFIG.maxPathExpansions);

/** Server-only data per player. Never sent to clients. */
interface PlayerRuntime {
  character: MovingCharacter;
  intentWindowStart: number;
  intentsInWindow: number;
}

/**
 * The single shared piazza for the walking skeleton. Authoritative over every
 * player's position: clients send intents, this room validates them,
 * simulates movement at a fixed rate and replicates the result.
 */
export class PlazaRoom extends Room<{ state: PlazaState }> {
  override maxClients = GAME_CONFIG.maxPlayersPerRoom;
  override patchRate = GAME_CONFIG.patchMs;
  override maxMessagesPerSecond = GAME_CONFIG.maxMessagesPerSecond;

  private readonly runtimes = new Map<string, PlayerRuntime>();
  private guestCounter = 0;
  private spawnCursor = 0;

  override onCreate(): void {
    this.state = new PlazaState();
    this.setSimulationInterval((deltaMs) => this.tick(deltaMs), GAME_CONFIG.tickMs);

    this.onMessage(ClientMessage.MoveTo, (client, payload) => this.handleMoveTo(client, payload));
    this.onMessage(ClientMessage.MoveDirection, (client, payload) => this.handleMoveDirection(client, payload));
    this.onMessage(ClientMessage.Stop, (client) => this.handleStop(client));
    this.onMessage("*", (client, type) => {
      // Unknown message types (including any attempt to send a position) are ignored.
      log.warn("plaza", `ignored unknown message "${String(type)}" from ${client.sessionId}`);
    });
    log.info("plaza", `room ${this.roomId} created`);
  }

  override onJoin(client: Client, options?: JoinOptions): void {
    const name = sanitizeDisplayName(options?.name) ?? `Guest ${++this.guestCounter}`;
    const spawn = this.nextSpawnPoint();
    const player = new PlayerState();
    player.name = name;
    player.x = spawn.x;
    player.z = spawn.z;
    player.rotation = Math.PI; // face north, into the piazza
    player.moving = false;
    player.connected = true;
    player.hue = hueFor(client.sessionId);
    this.state.players.set(client.sessionId, player);
    this.runtimes.set(client.sessionId, {
      character: { x: spawn.x, z: spawn.z, rotation: player.rotation, intent: { kind: "idle" } },
      intentWindowStart: 0,
      intentsInWindow: 0,
    });
    log.info("plaza", `${name} (${client.sessionId}) joined; ${this.clients.length} connected`);
  }

  override onDrop(client: Client, code?: number): void {
    const player = this.state.players.get(client.sessionId);
    const runtime = this.runtimes.get(client.sessionId);
    if (player) {
      player.connected = false;
      player.moving = false;
    }
    if (runtime) runtime.character.intent = { kind: "idle" };
    log.info("plaza", `${client.sessionId} dropped (code ${code ?? "?"}); holding for ${GAME_CONFIG.reconnectSeconds}s`);
    this.allowReconnection(client, GAME_CONFIG.reconnectSeconds);
  }

  override onReconnect(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    if (player) player.connected = true;
    log.info("plaza", `${client.sessionId} reconnected`);
  }

  override onLeave(client: Client, code?: number): void {
    this.state.players.delete(client.sessionId);
    this.runtimes.delete(client.sessionId);
    log.info("plaza", `${client.sessionId} left (code ${code ?? "?"}); ${this.clients.length} connected`);
  }

  override onDispose(): void {
    log.info("plaza", `room ${this.roomId} disposed`);
  }

  private tick(deltaMs: number): void {
    // Clamp so a stalled event loop cannot produce a giant teleport-like step.
    const dt = Math.min(deltaMs, GAME_CONFIG.tickMs * 4) / 1000;
    for (const [sessionId, runtime] of this.runtimes) {
      const player = this.state.players.get(sessionId);
      if (!player) continue;
      const result = stepCharacter(world, runtime.character, dt, GAME_CONFIG.walkSpeed, GAME_CONFIG.playerRadius);
      if (result.moved) {
        player.x = runtime.character.x;
        player.z = runtime.character.z;
        player.rotation = runtime.character.rotation;
      }
      const moving = runtime.character.intent.kind !== "idle" && result.moved;
      if (player.moving !== moving) player.moving = moving;
    }
  }

  private handleMoveTo(client: Client, payload: unknown): void {
    const runtime = this.acceptIntent(client, ClientMessage.MoveTo);
    if (!runtime) return;
    const parsed = parseMoveTo(payload);
    if (!parsed.ok) return this.reject(client, ClientMessage.MoveTo, parsed.reason);
    const path = navGrid.findPath(runtime.character, parsed.value);
    if (!path.ok) return this.reject(client, ClientMessage.MoveTo, path.reason);
    runtime.character.intent = { kind: "path", waypoints: path.waypoints };
  }

  private handleMoveDirection(client: Client, payload: unknown): void {
    const runtime = this.acceptIntent(client, ClientMessage.MoveDirection);
    if (!runtime) return;
    const parsed = parseMoveDirection(payload);
    if (!parsed.ok) return this.reject(client, ClientMessage.MoveDirection, parsed.reason);
    const { dx, dz } = parsed.value;
    runtime.character.intent = dx === 0 && dz === 0 ? { kind: "idle" } : { kind: "direction", dx, dz };
  }

  private handleStop(client: Client): void {
    const runtime = this.runtimes.get(client.sessionId);
    if (runtime) runtime.character.intent = { kind: "idle" };
  }

  /** Applies the per-player movement-intent rate limit. Returns null when refused. */
  private acceptIntent(client: Client, action: string): PlayerRuntime | null {
    const runtime = this.runtimes.get(client.sessionId);
    if (!runtime) return null;
    const now = Date.now();
    if (now - runtime.intentWindowStart >= 1000) {
      runtime.intentWindowStart = now;
      runtime.intentsInWindow = 0;
    }
    if (++runtime.intentsInWindow > GAME_CONFIG.maxMoveIntentsPerSecond) {
      if (runtime.intentsInWindow === GAME_CONFIG.maxMoveIntentsPerSecond + 1) {
        this.reject(client, action, "rate_limited");
      }
      return null;
    }
    return runtime;
  }

  private reject(client: Client, action: string, reason: string): void {
    const payload: RejectedPayload = { action, reason };
    client.send(ServerMessage.Rejected, payload);
  }

  private nextSpawnPoint(): { x: number; z: number } {
    const points = world.spawnPoints;
    for (let attempt = 0; attempt < points.length; attempt++) {
      const point = points[(this.spawnCursor + attempt) % points.length];
      if (point && isPositionWalkable(world, point.x, point.z, GAME_CONFIG.playerRadius)) {
        this.spawnCursor = (this.spawnCursor + attempt + 1) % points.length;
        return point;
      }
    }
    throw new Error("No walkable spawn point in world layout");
  }
}

/** Stable placeholder colour per session, so players are told apart. */
function hueFor(id: string): number {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % 360;
}
