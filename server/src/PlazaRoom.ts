import { Room, ServerError, type AuthContext, type Client, type Deferred } from "@colyseus/core";
import {
  CLOSE_SIGNED_IN_ELSEWHERE,
  ClientMessage,
  ERROR_INVALID_GUEST_TOKEN,
  GAME_CONFIG,
  NavGrid,
  ServerMessage,
  isPositionWalkable,
  parseAppearance,
  parseMoveDirection,
  parseMoveTo,
  parseNewCharacter,
  stepCharacter,
  type Appearance,
  type IdentityPayload,
  type JoinOptionsWithIdentity,
  type ProfileErrorPayload,
  type ProfilePayload,
  type RejectedPayload,
} from "@padova/shared";
import { InteractionSystem } from "./InteractionSystem.ts";
import { log } from "./log.ts";
import type { LoadedCharacter, ProfileService } from "./profiles/ProfileService.ts";
import type { Owner } from "./profiles/profileRepository.ts";
import type { SessionRegistry } from "./profiles/sessionRegistry.ts";
import type { PlayerRuntime } from "./runtime.ts";
import { PlayerState, PlazaState } from "./schema.ts";
import { getServices } from "./services.ts";
import { DEFAULT_TUNING, type PlazaRoomOptions, type RoomTuning } from "./tuning.ts";

/** What the server knows about one connection's identity. Never sent to clients. */
interface Session {
  /** Authenticated account (from a verified guest token or a fresh creation); null = anonymous. */
  accountId: string | null;
  /** Set once the character is loaded or created and placed in the world. */
  owner: Owner | null;
  ip: string | undefined;
  readOnly: boolean;
  evicted: boolean;
  creating: boolean;
  lastSaved: { x: number; z: number } | null;
}

interface AuthResult {
  accountId: string | null;
  ip: string | undefined;
}

const AREA = "plaza";

/**
 * The single shared piazza. Authoritative over every player's identity,
 * position and actions: clients send intents, this room validates them,
 * simulates movement at a fixed rate, runs interactions, persists profiles
 * and replicates the result.
 */
export class PlazaRoom extends Room<{ state: PlazaState }> {
  override maxClients = GAME_CONFIG.maxPlayersPerRoom;
  override patchRate = GAME_CONFIG.patchMs;
  override maxMessagesPerSecond = GAME_CONFIG.maxMessagesPerSecond;

  private readonly runtimes = new Map<string, PlayerRuntime>();
  private readonly sessions = new Map<string, Session>();
  private readonly reconnections = new Map<string, Deferred<Client>>();
  private tuning: RoomTuning = DEFAULT_TUNING;
  private nav!: NavGrid;
  private interactions!: InteractionSystem;
  private profiles!: ProfileService;
  private registry!: SessionRegistry;
  private spawnCursor = 0;

  override onCreate(options?: PlazaRoomOptions): void {
    this.tuning = { ...DEFAULT_TUNING, ...options?.tuning };
    const services = getServices(options?.servicesKey);
    this.profiles = services.profiles;
    this.registry = services.sessions;
    this.nav = new NavGrid(this.tuning.world, GAME_CONFIG.navCellSize, GAME_CONFIG.playerRadius, GAME_CONFIG.maxPathExpansions);
    this.state = new PlazaState();
    this.interactions = new InteractionSystem({
      state: this.state,
      runtimes: this.runtimes,
      nav: this.nav,
      tuning: this.tuning,
      send: (sessionId, type, payload) => this.clients.getById(sessionId)?.send(type, payload),
      now: () => Date.now(),
    });
    this.setSimulationInterval((deltaMs) => this.tick(deltaMs), GAME_CONFIG.tickMs);
    this.clock.setInterval(() => void this.autosave(), this.tuning.autosaveIntervalMs);

    this.onMessage(ClientMessage.MoveTo, (client, payload) => this.handleMoveTo(client, payload));
    this.onMessage(ClientMessage.MoveDirection, (client, payload) => this.handleMoveDirection(client, payload));
    this.onMessage(ClientMessage.Stop, (client) => this.handleStop(client));
    this.onMessage(ClientMessage.Interact, (client, payload) => {
      if (this.acceptIntent(client, ClientMessage.Interact)) this.interactions.request(client.sessionId, payload);
    });
    this.onMessage(ClientMessage.CancelAction, (client) => this.interactions.cancelRequest(client.sessionId));
    this.onMessage(ClientMessage.CreateCharacter, (client, payload) => void this.handleCreateCharacter(client, payload));
    this.onMessage(ClientMessage.UpdateAppearance, (client, payload) => void this.handleUpdateAppearance(client, payload));
    this.onMessage("*", (client, type) => {
      // Unknown message types (including any attempt to send a position) are ignored.
      log.warn("plaza", `ignored unknown message "${String(type)}" from ${client.sessionId}`);
    });
    log.info("plaza", `room ${this.roomId} created`);
  }

  // ── Identity ────────────────────────────────────────────────────────────

  /**
   * Runs before onJoin. A guest token (sent in the matchmaking request body)
   * is the only accepted proof of an account. No token = anonymous, which may
   * create a character. A token that is not recognised is refused so the
   * client can tell the player instead of silently starting over.
   */
  override async onAuth(_client: Client, options: JoinOptionsWithIdentity | undefined, context: AuthContext): Promise<AuthResult> {
    const token = options?.guestToken;
    if (token === undefined || token === null || token === "") return { accountId: null, ip: context.ip };
    const accountId = typeof token === "string" ? await this.profiles.authenticate(token) : null;
    if (!accountId) throw new ServerError(ERROR_INVALID_GUEST_TOKEN, "invalid_guest_token");
    return { accountId, ip: context.ip };
  }

  override async onJoin(client: Client, _options?: unknown, auth?: AuthResult): Promise<void> {
    const session: Session = {
      accountId: auth?.accountId ?? null,
      owner: null,
      ip: auth?.ip,
      readOnly: false,
      evicted: false,
      creating: false,
      lastSaved: null,
    };
    this.sessions.set(client.sessionId, session);

    if (!session.accountId) {
      this.sendProfile(client, { status: "needs_character" });
      log.info("plaza", `anonymous visitor ${client.sessionId} joined; ${this.clients.length} connected`);
      return;
    }

    await this.claimAccount(client.sessionId, session.accountId);
    const loaded = await this.profiles.load(session.accountId);
    if (!this.isStillHere(client.sessionId)) return;
    if (!loaded) {
      this.sendProfile(client, { status: "needs_character" });
      return;
    }
    this.spawn(client, session, loaded);
    this.sendProfile(client, { status: "ready", profile: loaded.profile, readOnly: loaded.readOnly, notices: loaded.notices });
  }

  override onDrop(client: Client, code?: number): void {
    const player = this.state.players.get(client.sessionId);
    const runtime = this.runtimes.get(client.sessionId);
    this.interactions.onDrop(client.sessionId);
    if (player) {
      player.connected = false;
      player.moving = false;
    }
    if (runtime) runtime.character.intent = { kind: "idle" };
    log.info("plaza", `${client.sessionId} dropped (code ${code ?? "?"}); holding for ${GAME_CONFIG.reconnectSeconds}s`);
    const reconnection = this.allowReconnection(client, GAME_CONFIG.reconnectSeconds);
    this.reconnections.set(client.sessionId, reconnection);
    reconnection.promise.then(
      () => this.reconnections.delete(client.sessionId),
      () => this.reconnections.delete(client.sessionId),
    );
  }

  override onReconnect(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    if (player) player.connected = true;
    log.info("plaza", `${client.sessionId} reconnected`);
  }

  override async onLeave(client: Client, code?: number): Promise<void> {
    const session = this.sessions.get(client.sessionId);
    if (session && !session.evicted) await this.saveAndRemove(client.sessionId);
    this.sessions.delete(client.sessionId);
    if (session?.accountId) this.registry.release(session.accountId, client.sessionId);
    log.info("plaza", `${client.sessionId} left (code ${code ?? "?"}); ${this.clients.length} connected`);
  }

  override async onDispose(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((sessionId) => this.saveCharacter(sessionId)));
    log.info("plaza", `room ${this.roomId} disposed`);
  }

  /** Newest session wins: any other session of this account is saved and disconnected first. */
  private claimAccount(sessionId: string, accountId: string): Promise<void> {
    return this.registry.claim(accountId, sessionId, () => this.evict(sessionId));
  }

  private async evict(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || session.evicted) return;
    session.evicted = true;
    await this.saveAndRemove(sessionId);
    log.info("plaza", `${sessionId} signed in elsewhere; disconnecting this session`);
    this.clients.getById(sessionId)?.leave(CLOSE_SIGNED_IN_ELSEWHERE, "signed_in_elsewhere");
    // A dropped session waiting to reconnect must not come back as a duplicate.
    this.reconnections.get(sessionId)?.reject(new Error("signed_in_elsewhere"));
  }

  private isStillHere(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    return Boolean(session && !session.evicted && this.clients.getById(sessionId));
  }

  // ── Profiles ────────────────────────────────────────────────────────────

  private async handleCreateCharacter(client: Client, payload: unknown): Promise<void> {
    const session = this.sessions.get(client.sessionId);
    if (!session || session.evicted) return;
    if (session.owner) return this.profileError(client, { action: "createCharacter", reason: "already_has_character" });
    if (session.creating) return; // a creation for this session is already in flight
    const parsed = parseNewCharacter(payload);
    if (!parsed.ok) return this.profileError(client, { action: "createCharacter", reason: parsed.reason, field: parsed.field });
    if (!session.accountId && !this.profiles.allowGuestCreation(session.ip)) {
      return this.profileError(client, { action: "createCharacter", reason: "rate_limited" });
    }

    session.creating = true;
    try {
      const spawnPoint = this.nextSpawnPoint();
      const result = await this.profiles.create(parsed.value, session.accountId, { area: AREA, x: spawnPoint.x, z: spawnPoint.z, rotation: Math.PI });
      if (result === "already_has_character") return this.profileError(client, { action: "createCharacter", reason: "already_has_character" });
      if (!this.isStillHere(client.sessionId)) return;
      if (result.guestToken) {
        const identity: IdentityPayload = { guestToken: result.guestToken };
        client.send(ServerMessage.Identity, identity);
      }
      session.accountId = result.accountId;
      await this.claimAccount(client.sessionId, result.accountId);
      this.spawn(client, session, result.loaded);
      this.sendProfile(client, { status: "ready", profile: result.loaded.profile, notices: result.loaded.notices });
      log.info("plaza", `${client.sessionId} created character ${result.loaded.profile.characterId}`);
    } catch (error) {
      log.error("plaza", `character creation failed for ${client.sessionId}: ${(error as Error).message}`);
      this.profileError(client, { action: "createCharacter", reason: "storage_error" });
    } finally {
      session.creating = false;
    }
  }

  private async handleUpdateAppearance(client: Client, payload: unknown): Promise<void> {
    const session = this.sessions.get(client.sessionId);
    if (!session?.owner) return this.profileError(client, { action: "updateAppearance", reason: "no_character" });
    if (!this.acceptIntent(client, ClientMessage.UpdateAppearance)) return;
    if (session.readOnly) return this.profileError(client, { action: "updateAppearance", reason: "profile_newer_version" });
    // Only `appearance` is read; any id or owner in the payload is ignored.
    const appearancePayload = typeof payload === "object" && payload !== null ? (payload as { appearance?: unknown }).appearance : undefined;
    const parsed = parseAppearance(appearancePayload);
    if (!parsed.ok) return this.profileError(client, { action: "updateAppearance", reason: parsed.reason, field: parsed.field });
    try {
      const profile = await this.profiles.updateAppearance(session.owner, parsed.value);
      if (!profile) return this.profileError(client, { action: "updateAppearance", reason: "no_character" });
      const player = this.state.players.get(client.sessionId);
      if (player) applyAppearance(player, profile.appearance);
      this.sendProfile(client, { status: "ready", profile });
    } catch (error) {
      log.error("plaza", `appearance update failed for ${client.sessionId}: ${(error as Error).message}`);
      this.profileError(client, { action: "updateAppearance", reason: "storage_error" });
    }
  }

  /** Places a loaded character in the world, at its saved position when that is still valid. */
  private spawn(client: Client, session: Session, loaded: LoadedCharacter): void {
    const saved = loaded.state;
    const position =
      saved && saved.area === AREA && isPositionWalkable(this.tuning.world, saved.x, saved.z, GAME_CONFIG.playerRadius)
        ? { x: saved.x, z: saved.z, rotation: saved.rotation }
        : { ...this.nextSpawnPoint(), rotation: Math.PI };
    const player = new PlayerState();
    player.name = loaded.profile.displayName;
    player.x = position.x;
    player.z = position.z;
    player.rotation = position.rotation;
    player.moving = false;
    player.connected = true;
    applyAppearance(player, loaded.profile.appearance);
    player.activity = "idle";
    player.seatId = "";
    player.targetId = "";
    this.state.players.set(client.sessionId, player);
    this.runtimes.set(client.sessionId, {
      character: { x: position.x, z: position.z, rotation: position.rotation, intent: { kind: "idle" } },
      intentWindowStart: 0,
      intentsInWindow: 0,
      pending: null,
      lastGreetAt: new Map(),
    });
    session.owner = loaded.owner;
    session.readOnly = loaded.readOnly;
    session.lastSaved = { x: position.x, z: position.z };
    log.info("plaza", `${loaded.profile.displayName} (${client.sessionId}) entered; ${this.state.players.size} in the world`);
  }

  /** Saves the character (if any) and removes it from the world. */
  private async saveAndRemove(sessionId: string): Promise<void> {
    const save = this.saveCharacter(sessionId);
    this.interactions.onLeave(sessionId);
    this.state.players.delete(sessionId);
    this.runtimes.delete(sessionId);
    await save;
  }

  /** Persists position. Seated characters are saved at the spot they would stand up to. */
  private async saveCharacter(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    const runtime = this.runtimes.get(sessionId);
    if (!session?.owner || !runtime) return;
    const standing = this.interactions.standingPosition(sessionId) ?? { x: runtime.character.x, z: runtime.character.z };
    const state = { area: AREA, x: standing.x, z: standing.z, rotation: runtime.character.rotation };
    try {
      await this.profiles.saveState(session.owner, state);
      session.lastSaved = { x: state.x, z: state.z };
    } catch (error) {
      log.error("plaza", `could not save ${sessionId}: ${(error as Error).message}`);
    }
  }

  private async autosave(): Promise<void> {
    const moved = [...this.sessions.entries()].filter(([sessionId, session]) => {
      const runtime = this.runtimes.get(sessionId);
      if (!session.owner || !runtime || !session.lastSaved) return false;
      return Math.hypot(runtime.character.x - session.lastSaved.x, runtime.character.z - session.lastSaved.z) > 0.1;
    });
    await Promise.all(moved.map(([sessionId]) => this.saveCharacter(sessionId)));
  }

  private sendProfile(client: Client, payload: ProfilePayload): void {
    client.send(ServerMessage.Profile, payload);
  }

  private profileError(client: Client, payload: ProfileErrorPayload): void {
    client.send(ServerMessage.ProfileError, payload);
  }

  // ── Simulation and movement ─────────────────────────────────────────────

  private tick(deltaMs: number): void {
    // Clamp so a stalled event loop cannot produce a giant teleport-like step.
    const dt = Math.min(deltaMs, GAME_CONFIG.tickMs * 4) / 1000;
    for (const [sessionId, runtime] of this.runtimes) {
      const player = this.state.players.get(sessionId);
      if (!player) continue;
      const result = stepCharacter(this.tuning.world, runtime.character, dt, this.tuning.walkSpeed, GAME_CONFIG.playerRadius);
      if (result.moved) {
        player.x = runtime.character.x;
        player.z = runtime.character.z;
        player.rotation = runtime.character.rotation;
      }
      const moving = runtime.character.intent.kind !== "idle" && result.moved;
      if (player.moving !== moving) player.moving = moving;
    }
    this.interactions.tick();
  }

  private handleMoveTo(client: Client, payload: unknown): void {
    const runtime = this.acceptIntent(client, ClientMessage.MoveTo);
    if (!runtime) return;
    const parsed = parseMoveTo(payload);
    if (!parsed.ok) return this.reject(client, ClientMessage.MoveTo, parsed.reason);
    // Plan from where the character will stand (a seated character stands up first),
    // and only change any state once the move is known to be possible.
    const start = this.interactions.standingPosition(client.sessionId);
    if (!start) return;
    const path = this.nav.findPath(start, parsed.value);
    if (!path.ok) return this.reject(client, ClientMessage.MoveTo, path.reason);
    this.interactions.onMovementIntent(client.sessionId, true);
    runtime.character.intent = { kind: "path", waypoints: path.waypoints };
  }

  private handleMoveDirection(client: Client, payload: unknown): void {
    const runtime = this.acceptIntent(client, ClientMessage.MoveDirection);
    if (!runtime) return;
    const parsed = parseMoveDirection(payload);
    if (!parsed.ok) return this.reject(client, ClientMessage.MoveDirection, parsed.reason);
    const { dx, dz } = parsed.value;
    if (dx === 0 && dz === 0) {
      // Releasing the keys only stops direct walking; it does not cancel an action.
      if (runtime.character.intent.kind === "direction") runtime.character.intent = { kind: "idle" };
      return;
    }
    this.interactions.onMovementIntent(client.sessionId, true);
    runtime.character.intent = { kind: "direction", dx, dz };
  }

  private handleStop(client: Client): void {
    const runtime = this.runtimes.get(client.sessionId);
    if (!runtime) return;
    this.interactions.onMovementIntent(client.sessionId, false);
    runtime.character.intent = { kind: "idle" };
  }

  /** Applies the per-player intent rate limit. Returns null when refused or not in the world. */
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
    const points = this.tuning.world.spawnPoints;
    for (let attempt = 0; attempt < points.length; attempt++) {
      const point = points[(this.spawnCursor + attempt) % points.length];
      if (point && isPositionWalkable(this.tuning.world, point.x, point.z, GAME_CONFIG.playerRadius)) {
        this.spawnCursor = (this.spawnCursor + attempt + 1) % points.length;
        return point;
      }
    }
    throw new Error("No walkable spawn point in world layout");
  }
}

function applyAppearance(player: PlayerState, appearance: Appearance): void {
  player.preset = appearance.preset;
  player.skinTone = appearance.skinTone;
  player.hairStyle = appearance.hairStyle;
  player.hairColour = appearance.hairColour;
  player.eyeColour = appearance.eyeColour;
  player.outfit = appearance.outfit;
}
