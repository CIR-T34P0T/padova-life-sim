import { Room, ServerError, type AuthContext, type Client, type Deferred } from "@colyseus/core";
import { StateView } from "@colyseus/schema";
import {
  CLOSE_SIGNED_IN_ELSEWHERE,
  ClientMessage,
  ERROR_INVALID_GUEST_TOKEN,
  GAME_CONFIG,
  PLAZA_AREA,
  ServerMessage,
  confirmNameMatches,
  encodeLook,
  gameMinuteAt,
  isPositionWalkable,
  parseAppearance,
  parseCharacterId,
  parseDeleteCharacter,
  parseEnterWorld,
  parseMoveDirection,
  parseMoveTo,
  parseNewCharacter,
  stepCharacter,
  type AppearanceConfig,
  type DoorLink,
  type IdentityPayload,
  type JoinOptionsWithIdentity,
  type ProfileErrorPayload,
  type ProfilePayload,
  type RejectedPayload,
} from "@padova/shared";
import { AreaWorlds } from "./areas.ts";
import { InteractionSystem } from "./InteractionSystem.ts";
import type { LifeService, LoadedLife } from "./life/LifeService.ts";
import { LifeSystem, type GameClock } from "./life/LifeSystem.ts";
import { log } from "./log.ts";
import { toSummary, type LoadedCharacter, type ProfileService } from "./profiles/ProfileService.ts";
import type { Owner } from "./profiles/profileRepository.ts";
import type { SessionRegistry } from "./profiles/sessionRegistry.ts";
import type { PlayerRuntime } from "./runtime.ts";
import { PlayerState, PlazaState } from "./schema.ts";
import { getServices } from "./services.ts";
import { DEFAULT_TUNING, resolveTuning, type PlazaRoomOptions, type RoomTuning } from "./tuning.ts";

/** What the server knows about one connection's identity. Never sent to clients. */
interface Session {
  /** Authenticated account (from a verified guest token or a fresh creation); null = anonymous. */
  accountId: string | null;
  /** Set once the character is loaded or created and placed in the world. */
  owner: Owner | null;
  ip: string | undefined;
  readOnly: boolean;
  evicted: boolean;
  /** A profile request (create, enter, leave, delete, lobby appearance change) is in flight. */
  busy: boolean;
  lastSaved: { x: number; z: number } | null;
  /**
   * Set once removal starts: resolves when the final save is written. A new
   * session of the same account waits for it before loading, so it never
   * reads a position older than the one being saved.
   */
  removal: Promise<void> | null;
}

interface AuthResult {
  accountId: string | null;
  ip: string | undefined;
}


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
  /** The square and the indoor rooms, each with its layout and navigation grid (M7c). */
  private areas!: AreaWorlds;
  private interactions!: InteractionSystem;
  private life!: LifeSystem;
  private lifeService!: LifeService;
  private gameClock!: GameClock;
  private profiles!: ProfileService;
  private registry!: SessionRegistry;
  private spawnCursor = 0;

  override onCreate(options?: PlazaRoomOptions): void {
    this.tuning = resolveTuning(options?.tuning);
    const services = getServices(options?.servicesKey);
    this.profiles = services.profiles;
    this.lifeService = services.life;
    const scale = this.tuning.timeScale;
    const offset = this.tuning.clockOffsetMinutes;
    this.gameClock = { scale, minute: () => gameMinuteAt(Date.now(), scale, offset) };
    this.registry = services.sessions;
    this.areas = new AreaWorlds(this.tuning.world);
    this.state = new PlazaState();
    this.state.gameMinute = Math.floor(this.gameClock.minute());
    const send = (sessionId: string, type: string, payload: unknown) => this.clients.getById(sessionId)?.send(type, payload);
    this.life = new LifeSystem({
      state: this.state,
      runtimes: this.runtimes,
      service: this.lifeService,
      clock: this.gameClock,
      send,
      requestSave: (sessionId) => void this.saveCharacter(sessionId),
      now: () => Date.now(),
    });
    this.interactions = new InteractionSystem({
      state: this.state,
      runtimes: this.runtimes,
      area: (sessionId) => this.areas.of(this.runtimes.get(sessionId)?.area ?? PLAZA_AREA),
      enterArea: (sessionId, link) => this.enterArea(sessionId, link),
      tuning: this.tuning,
      send,
      now: () => Date.now(),
      hooks: this.life,
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
    this.onMessage(ClientMessage.EnterWorld, (client, payload) => void this.handleEnterWorld(client, payload));
    this.onMessage(ClientMessage.LeaveWorld, (client) => void this.handleLeaveWorld(client));
    this.onMessage(ClientMessage.DeleteCharacter, (client, payload) => void this.handleDeleteCharacter(client, payload));
    this.onMessage(ClientMessage.QuitJob, (client) => this.handleQuitJob(client));
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

  /**
   * Joining puts the session in the lobby (the title screen): it receives its
   * account's characters, but no character enters the world until the
   * player picks one (EnterWorld) or creates one (CreateCharacter).
   */
  override async onJoin(client: Client, _options?: unknown, auth?: AuthResult): Promise<void> {
    const session: Session = {
      accountId: auth?.accountId ?? null,
      owner: null,
      ip: auth?.ip,
      readOnly: false,
      evicted: false,
      busy: false,
      lastSaved: null,
      removal: null,
    };
    this.sessions.set(client.sessionId, session);
    // Each client sees only the players in its own area, and nobody at the title screen (M7c).
    client.view = new StateView();
    await this.sendLobby(client, session);
    log.info("plaza", `${session.accountId ? "guest" : "anonymous visitor"} ${client.sessionId} joined the lobby; ${this.clients.length} connected`);
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
    if (!client.view) client.view = new StateView();
    this.refreshViews();
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

  /**
   * Newest session wins: any other session of this account that is in the
   * world is saved and disconnected first. Sessions that are only at the
   * title screen don't claim the account.
   */
  private claimAccount(sessionId: string, accountId: string, characterId: string): Promise<void> {
    return this.registry.claim(accountId, sessionId, () => this.evict(sessionId), characterId);
  }

  private async evict(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    if (session.evicted) return session.removal ?? undefined;
    session.evicted = true;
    // If the old session is already leaving, this waits for its save in flight.
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

  /** Sends this session's lobby: its account's characters, most recently played first. */
  private async sendLobby(client: Client, session: Session): Promise<void> {
    const maxCharacters = this.profiles.maxCharactersPerAccount;
    if (!session.accountId) return this.sendProfile(client, { status: "lobby", characters: [], maxCharacters });
    try {
      const characters = await this.profiles.list(session.accountId);
      if (!this.isStillHere(client.sessionId)) return;
      this.sendProfile(client, { status: "lobby", characters: characters.map(toSummary), maxCharacters });
    } catch (error) {
      log.error("plaza", `could not list characters for ${client.sessionId}: ${(error as Error).message}`);
      this.profileError(client, { action: "listCharacters", reason: "storage_error" });
    }
  }

  /** Runs one profile request at a time per session; refuses with "busy" otherwise. */
  private async exclusive(client: Client, session: Session, action: ProfileErrorPayload["action"], work: () => Promise<void>): Promise<void> {
    if (session.busy) return this.profileError(client, { action, reason: "busy" });
    session.busy = true;
    try {
      await work();
    } catch (error) {
      log.error("plaza", `${action} failed for ${client.sessionId}: ${(error as Error).message}`);
      if (this.isStillHere(client.sessionId)) this.profileError(client, { action, reason: "storage_error" });
    } finally {
      session.busy = false;
    }
  }

  private async handleCreateCharacter(client: Client, payload: unknown): Promise<void> {
    const session = this.sessions.get(client.sessionId);
    if (!session || session.evicted) return;
    if (session.owner) return this.profileError(client, { action: "createCharacter", reason: "in_world" });
    const parsed = parseNewCharacter(payload);
    if (!parsed.ok) return this.profileError(client, { action: "createCharacter", reason: parsed.reason, field: parsed.field });
    if (session.busy) return this.profileError(client, { action: "createCharacter", reason: "busy" });
    if (!session.accountId && !this.profiles.allowGuestCreation(session.ip)) {
      return this.profileError(client, { action: "createCharacter", reason: "rate_limited" });
    }

    await this.exclusive(client, session, "createCharacter", async () => {
      const spawnPoint = this.nextSpawnPoint();
      const result = await this.profiles.create(
        parsed.value,
        session.accountId,
        { area: PLAZA_AREA, x: spawnPoint.x, z: spawnPoint.z, rotation: Math.PI },
        { startingBalanceCents: this.tuning.startingBalanceCents, gameMinute: this.gameClock.minute() },
      );
      if (result === "too_many_characters") return this.profileError(client, { action: "createCharacter", reason: "too_many_characters" });
      const life = await this.lifeService.load(result.loaded.owner, this.gameClock.minute());
      if (!this.isStillHere(client.sessionId)) return;
      if (result.guestToken) {
        const identity: IdentityPayload = { guestToken: result.guestToken };
        client.send(ServerMessage.Identity, identity);
      }
      session.accountId = result.accountId;
      await this.claimAccount(client.sessionId, result.accountId, result.loaded.owner.characterId);
      if (!this.isStillHere(client.sessionId)) return;
      this.spawn(client, session, result.loaded, life);
      this.sendProfile(client, { status: "ready", profile: result.loaded.profile, notices: result.loaded.notices });
      log.info("plaza", `${client.sessionId} created character ${result.loaded.profile.characterId}`);
    });
  }

  /** Enters the world with one of this account's characters (picked at the title screen). */
  private async handleEnterWorld(client: Client, payload: unknown): Promise<void> {
    const session = this.sessions.get(client.sessionId);
    if (!session || session.evicted) return;
    if (session.owner) return this.profileError(client, { action: "enterWorld", reason: "in_world" });
    const parsed = parseEnterWorld(payload);
    if (!parsed) return this.profileError(client, { action: "enterWorld", reason: "invalid_payload" });
    const accountId = session.accountId;
    if (!accountId) return this.profileError(client, { action: "enterWorld", reason: "character_not_found" });

    await this.exclusive(client, session, "enterWorld", async () => {
      const owner: Owner = { accountId, characterId: parsed.characterId };
      // Claim first: another window playing this account saves and leaves before we read the profile.
      await this.claimAccount(client.sessionId, accountId, owner.characterId);
      if (!this.isStillHere(client.sessionId)) return;
      let loaded: LoadedCharacter | null;
      let life: LoadedLife | null = null;
      try {
        loaded = await this.profiles.load(owner);
        if (loaded) life = await this.lifeService.load(owner, this.gameClock.minute());
      } catch (error) {
        this.registry.release(accountId, client.sessionId);
        throw error;
      }
      if (!this.isStillHere(client.sessionId)) return;
      if (!loaded) {
        this.registry.release(accountId, client.sessionId);
        this.profileError(client, { action: "enterWorld", reason: "character_not_found" });
        return this.sendLobby(client, session);
      }
      this.spawn(client, session, loaded, life);
      this.sendProfile(client, { status: "ready", profile: loaded.profile, readOnly: loaded.readOnly, notices: loaded.notices });
    });
  }

  /** Saves the character, takes it out of the world and returns this session to the lobby. */
  private async handleLeaveWorld(client: Client): Promise<void> {
    const session = this.sessions.get(client.sessionId);
    if (!session || session.evicted) return;
    if (session.busy) return; // a create / enter in flight: the client gets its result first
    if (!session.owner) return this.sendLobby(client, session);
    session.busy = true;
    try {
      await this.saveAndRemove(client.sessionId);
      if (session.evicted) return;
      session.owner = null;
      session.readOnly = false;
      session.lastSaved = null;
      session.removal = null;
      if (session.accountId) this.registry.release(session.accountId, client.sessionId);
      log.info("plaza", `${client.sessionId} went back to the title screen; ${this.state.players.size} in the world`);
    } finally {
      session.busy = false;
    }
    if (this.isStillHere(client.sessionId)) await this.sendLobby(client, session);
  }

  /** Permanently deletes one of this account's characters. Title screen only, with the name typed to confirm. */
  private async handleDeleteCharacter(client: Client, payload: unknown): Promise<void> {
    const session = this.sessions.get(client.sessionId);
    if (!session || session.evicted) return;
    if (session.owner) return this.profileError(client, { action: "deleteCharacter", reason: "in_world" });
    const parsed = parseDeleteCharacter(payload);
    if (!parsed) return this.profileError(client, { action: "deleteCharacter", reason: "invalid_payload" });
    const accountId = session.accountId;
    if (!accountId) return this.profileError(client, { action: "deleteCharacter", reason: "character_not_found" });

    await this.exclusive(client, session, "deleteCharacter", async () => {
      const owner: Owner = { accountId, characterId: parsed.characterId };
      const inUse = () => this.registry.characterOf(accountId) === owner.characterId;
      if (inUse()) return this.profileError(client, { action: "deleteCharacter", reason: "character_in_use" });
      const loaded = await this.profiles.load(owner);
      if (!loaded) return this.profileError(client, { action: "deleteCharacter", reason: "character_not_found" });
      if (!confirmNameMatches(parsed.confirmName, loaded.profile.displayName)) {
        return this.profileError(client, { action: "deleteCharacter", reason: "confirm_name_mismatch" });
      }
      if (inUse()) return this.profileError(client, { action: "deleteCharacter", reason: "character_in_use" });
      if (!(await this.profiles.delete(owner))) return this.profileError(client, { action: "deleteCharacter", reason: "character_not_found" });
      log.info("plaza", `${client.sessionId} deleted character ${owner.characterId}`);
      if (this.isStillHere(client.sessionId)) await this.sendLobby(client, session);
    });
  }

  /**
   * Changes appearance only: needs, money, skills, traits and position are
   * never touched. In the world: the character being played (any id in the
   * payload is ignored). At the title screen: the character named by
   * `characterId`, if this account owns it and it isn't being played.
   */
  private async handleUpdateAppearance(client: Client, payload: unknown): Promise<void> {
    const session = this.sessions.get(client.sessionId);
    if (!session || session.evicted) return;
    const record = typeof payload === "object" && payload !== null ? (payload as { appearance?: unknown; characterId?: unknown }) : {};
    if (session.owner) return this.updateAppearanceInWorld(client, session, session.owner, record.appearance);

    const accountId = session.accountId;
    const characterId = parseCharacterId(record.characterId);
    if (!accountId || !characterId) return this.profileError(client, { action: "updateAppearance", reason: "character_not_found" });
    const parsed = parseAppearance(record.appearance);
    if (!parsed.ok) return this.profileError(client, { action: "updateAppearance", reason: parsed.reason, field: parsed.field });
    await this.exclusive(client, session, "updateAppearance", async () => {
      const owner: Owner = { accountId, characterId };
      if (this.registry.characterOf(accountId) === characterId) {
        return this.profileError(client, { action: "updateAppearance", reason: "character_in_use" });
      }
      const loaded = await this.profiles.load(owner);
      if (!loaded) return this.profileError(client, { action: "updateAppearance", reason: "character_not_found" });
      if (loaded.readOnly) return this.profileError(client, { action: "updateAppearance", reason: "profile_newer_version" });
      const profile = await this.profiles.updateAppearance(owner, parsed.value);
      if (!profile) return this.profileError(client, { action: "updateAppearance", reason: "character_not_found" });
      if (this.isStillHere(client.sessionId)) await this.sendLobby(client, session);
    });
  }

  private async updateAppearanceInWorld(client: Client, session: Session, owner: Owner, appearance: unknown): Promise<void> {
    if (!this.acceptIntent(client, ClientMessage.UpdateAppearance)) return;
    if (session.readOnly) return this.profileError(client, { action: "updateAppearance", reason: "profile_newer_version" });
    const parsed = parseAppearance(appearance);
    if (!parsed.ok) return this.profileError(client, { action: "updateAppearance", reason: parsed.reason, field: parsed.field });
    try {
      const profile = await this.profiles.updateAppearance(owner, parsed.value);
      if (!profile) return this.profileError(client, { action: "updateAppearance", reason: "character_not_found" });
      const player = this.state.players.get(client.sessionId);
      if (player) applyAppearance(player, profile.appearance);
      this.sendProfile(client, { status: "ready", profile });
    } catch (error) {
      log.error("plaza", `appearance update failed for ${client.sessionId}: ${(error as Error).message}`);
      this.profileError(client, { action: "updateAppearance", reason: "storage_error" });
    }
  }

  /** Places a loaded character in the world, at its saved position when that is still valid. */
  private spawn(client: Client, session: Session, loaded: LoadedCharacter, life: LoadedLife | null): void {
    const saved = loaded.state;
    // Back in the area and spot where the character was saved, if that area still
    // exists and the spot is still walkable; otherwise at the square's spawn points.
    const savedArea = saved && this.areas.has(saved.area) ? this.areas.of(saved.area) : null;
    const resume = saved && savedArea && isPositionWalkable(savedArea.layout, saved.x, saved.z, GAME_CONFIG.playerRadius);
    const area = resume ? savedArea.id : PLAZA_AREA;
    const position = resume ? { x: saved.x, z: saved.z, rotation: saved.rotation } : { ...this.nextSpawnPoint(), rotation: Math.PI };
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
    player.area = area;
    this.state.players.set(client.sessionId, player);
    this.runtimes.set(client.sessionId, {
      area,
      character: { x: position.x, z: position.z, rotation: position.rotation, intent: { kind: "idle" } },
      intentWindowStart: 0,
      intentsInWindow: 0,
      pending: null,
      lastGreetAt: new Map(),
    });
    session.owner = loaded.owner;
    session.readOnly = loaded.readOnly;
    session.lastSaved = { x: position.x, z: position.z };
    if (life) this.life.attach(client.sessionId, loaded.owner, life);
    else log.error("plaza", `no life data for ${client.sessionId}; needs, skills and money are unavailable`);
    this.refreshViews();
    log.info("plaza", `${loaded.profile.displayName} (${client.sessionId}) entered (${area}); ${this.state.players.size} in the world`);
  }

  /**
   * Shows each client exactly the players in its own area (M7c). Called when
   * someone enters the world, changes area or reconnects; removals from the
   * player map reach every view by themselves.
   */
  private refreshViews(): void {
    for (const client of this.clients) {
      const view = client.view;
      if (!view) continue;
      const mine = this.runtimes.get(client.sessionId)?.area;
      this.state.players.forEach((player, sessionId) => {
        const visible = mine !== undefined && this.runtimes.get(sessionId)?.area === mine;
        if (visible) view.add(player);
        else view.remove(player);
      });
    }
  }

  /**
   * Moves a character through a door (M7c), called by the interaction system
   * once the character has reached the door: to the spot in front of the
   * linked door in the other area, facing away from it. False if the door
   * leads nowhere (nothing changes).
   */
  private enterArea(sessionId: string, link: DoorLink): boolean {
    const runtime = this.runtimes.get(sessionId);
    const player = this.state.players.get(sessionId);
    const arrival = this.areas.arrival(link);
    if (!runtime || !player || !arrival) return false;
    runtime.area = arrival.area;
    runtime.character.x = arrival.x;
    runtime.character.z = arrival.z;
    runtime.character.rotation = arrival.rotation;
    runtime.character.intent = { kind: "idle" };
    player.area = arrival.area;
    player.x = arrival.x;
    player.z = arrival.z;
    player.rotation = arrival.rotation;
    player.moving = false;
    // Going through a door is not walking: no fitness for the jump.
    this.life.resetDistance(sessionId);
    this.refreshViews();
    log.info("plaza", `${sessionId} went to ${arrival.area}`);
    return true;
  }

  /**
   * Saves the character (if any) and removes it from the world. Safe to call
   * more than once: later calls wait for the same save instead of starting
   * a second one after the character is already gone.
   */
  private saveAndRemove(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session?.removal) return session.removal;
    const save = this.saveCharacter(sessionId); // takes its snapshot synchronously
    if (session) session.removal = save;
    this.interactions.onLeave(sessionId);
    this.life.detach(sessionId);
    this.state.players.delete(sessionId);
    this.runtimes.delete(sessionId);
    return save;
  }

  /**
   * Persists position and life data (needs, skills, mood events) in one
   * transaction. Seated characters are saved at the spot they would stand up
   * to. Everything is read synchronously before the first await, so callers
   * may remove the character right after calling this. Money is not saved
   * here: every money change is already its own transaction.
   */
  private async saveCharacter(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    const runtime = this.runtimes.get(sessionId);
    if (!session?.owner || !runtime) return;
    const standing = this.interactions.standingPosition(sessionId) ?? { x: runtime.character.x, z: runtime.character.z };
    const state = { area: runtime.area, x: standing.x, z: standing.z, rotation: runtime.character.rotation };
    const life = this.life.snapshot(sessionId);
    try {
      await this.lifeService.saveAll(session.owner, state, life);
      session.lastSaved = { x: state.x, z: state.z };
    } catch (error) {
      log.error("plaza", `could not save ${sessionId}: ${(error as Error).message}`);
    }
  }

  /** Needs change all the time, so every character in the world is saved on each autosave. */
  private async autosave(): Promise<void> {
    const inWorld = [...this.sessions.entries()].filter(([sessionId, session]) => session.owner && this.runtimes.has(sessionId));
    await Promise.all(inWorld.map(([sessionId]) => this.saveCharacter(sessionId)));
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
      const result = stepCharacter(this.areas.of(runtime.area).layout, runtime.character, dt, this.tuning.walkSpeed, GAME_CONFIG.playerRadius);
      if (result.moved) {
        player.x = runtime.character.x;
        player.z = runtime.character.z;
        player.rotation = runtime.character.rotation;
      }
      const moving = runtime.character.intent.kind !== "idle" && result.moved;
      if (player.moving !== moving) player.moving = moving;
    }
    this.life.tick(dt * 1000);
    this.interactions.tick();
    const minute = Math.floor(this.gameClock.minute());
    if (this.state.gameMinute !== minute) this.state.gameMinute = minute;
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
    const path = this.areas.of(runtime.area).nav.findPath(start, parsed.value);
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

  /** Quits the character's job. A shift in progress ends first, unpaid. No payload to validate. */
  private handleQuitJob(client: Client): void {
    if (!this.acceptIntent(client, ClientMessage.QuitJob)) return;
    if (!this.life.jobOf(client.sessionId)) return;
    this.interactions.cancelWork(client.sessionId);
    this.life.quitJob(client.sessionId);
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

function applyAppearance(player: PlayerState, appearance: AppearanceConfig): void {
  player.look = encodeLook(appearance);
}
