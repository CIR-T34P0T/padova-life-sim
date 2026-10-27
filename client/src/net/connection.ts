// Network layer: joins the plaza room, turns replicated state into simple
// events for the rest of the client, and sends intents. No game rules live
// here; the server decides outcomes.

import { Client, getStateCallbacks, type Room } from "@colyseus/sdk";
import {
  ClientMessage,
  ROOM_NAME,
  ServerMessage,
  decodeLook,
  type ActionUpdatePayload,
  type AppearanceConfig,
  type GreetedPayload,
  type IdentityPayload,
  type InteractPayload,
  type JoinOptionsWithIdentity,
  type LifePayload,
  type MoveDirectionPayload,
  type ProfileViewPayload,
  type RelationshipPayload,
  type ReportReason,
  type SafetyPayload,
  type SocialResultPayload,
  type StoryPayload,
  type MoveToPayload,
  type NewCharacterInput,
  type ProfileErrorPayload,
  type ProfilePayload,
  type RejectedPayload,
  type SeatOccupancy,
} from "@padova/shared";

export type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "disconnected";

export interface ReplicatedPlayer {
  name: string;
  x: number;
  z: number;
  rotation: number;
  moving: boolean;
  connected: boolean;
  /** Appearance config as canonical JSON (encodeLook). Decode with appearanceOf. */
  look: string;
  activity: string;
  seatId: string;
  targetId: string;
  /** The area the character is in (M7c): "plaza" or a room id. You only receive players in your own area. */
  area: string;
}

export interface ConnectionEvents {
  /** `code` is the close code when the connection ended (e.g. CLOSE_SIGNED_IN_ELSEWHERE). */
  onStatus(status: ConnectionStatus, detail?: string, code?: number): void;
  onPlayerAdded(id: string, player: ReplicatedPlayer): void;
  onPlayerChanged(id: string, player: ReplicatedPlayer): void;
  onPlayerRemoved(id: string): void;
  onSeatsChanged(): void;
  onRejected(payload: RejectedPayload): void;
  onActionUpdate(payload: ActionUpdatePayload): void;
  onGreeted(payload: GreetedPayload): void;
  onProfile(payload: ProfilePayload): void;
  onIdentity(payload: IdentityPayload): void;
  onProfileError(payload: ProfileErrorPayload): void;
  /** The player's own needs, mood, skills and money (D-024). */
  onLife(payload: LifePayload): void;
  /** The replicated world clock changed (game minute). */
  onClock(gameMinute: number): void;
  /** Relationships, blocks, reports and the story log (M9); all private to this player. */
  onProfileView(payload: ProfileViewPayload): void;
  onSafety(payload: SafetyPayload): void;
  onStory(payload: StoryPayload): void;
  onRelationship(payload: RelationshipPayload): void;
  onSocialResult(payload: SocialResultPayload): void;
}

/** The appearance of a replicated player. Never throws: unreadable looks become the default look. */
export function appearanceOf(player: ReplicatedPlayer): AppearanceConfig {
  return decodeLook(player.look ?? "").appearance;
}

export function resolveServerUrl(): string {
  const configured = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (configured) return configured;
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${location.hostname}:2567`;
}

const NO_SEATS: SeatOccupancy = new Map<string, string>();

export class GameConnection {
  private room: Room | null = null;

  constructor(private readonly events: ConnectionEvents) {}

  get sessionId(): string | null {
    return this.room?.sessionId ?? null;
  }

  /** Replicated seat occupancy (seatId → player id), for menu contents only. */
  get seats(): SeatOccupancy {
    return (this.room?.state?.seats as SeatOccupancy | undefined) ?? NO_SEATS;
  }

  /**
   * Joins the plaza. A stored guest token goes in the matchmaking request
   * body (never in a URL). Throws if the server refuses the token
   * (error code ERROR_INVALID_GUEST_TOKEN).
   */
  async join(options: JoinOptionsWithIdentity): Promise<void> {
    this.events.onStatus("connecting");
    const client = new Client(resolveServerUrl());
    const room = await client.joinOrCreate(ROOM_NAME, options);
    this.room = room;

    room.onDrop(() => this.events.onStatus("reconnecting"));
    room.onReconnect(() => this.events.onStatus("connected"));
    room.onLeave((code, reason) => {
      this.events.onStatus("disconnected", reason ? `${reason} (${code})` : `code ${code}`, code);
    });
    room.onError((code, message) => this.events.onStatus("disconnected", message ?? `error ${code}`));
    room.onMessage(ServerMessage.Rejected, (payload: RejectedPayload) => this.events.onRejected(payload));
    room.onMessage(ServerMessage.ActionUpdate, (payload: ActionUpdatePayload) => this.events.onActionUpdate(payload));
    room.onMessage(ServerMessage.Greeted, (payload: GreetedPayload) => this.events.onGreeted(payload));
    room.onMessage(ServerMessage.Profile, (payload: ProfilePayload) => this.events.onProfile(payload));
    room.onMessage(ServerMessage.Identity, (payload: IdentityPayload) => this.events.onIdentity(payload));
    room.onMessage(ServerMessage.ProfileError, (payload: ProfileErrorPayload) => this.events.onProfileError(payload));
    room.onMessage(ServerMessage.Life, (payload: LifePayload) => this.events.onLife(payload));
    room.onMessage(ServerMessage.ProfileView, (payload: ProfileViewPayload) => this.events.onProfileView(payload));
    room.onMessage(ServerMessage.Safety, (payload: SafetyPayload) => this.events.onSafety(payload));
    room.onMessage(ServerMessage.Story, (payload: StoryPayload) => this.events.onStory(payload));
    room.onMessage(ServerMessage.Relationship, (payload: RelationshipPayload) => this.events.onRelationship(payload));
    room.onMessage(ServerMessage.SocialResult, (payload: SocialResultPayload) => this.events.onSocialResult(payload));

    // The SDK's callback proxy is loosely typed for schema() classes.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const $ = getStateCallbacks(room) as any;
    $(room.state).players.onAdd((player: ReplicatedPlayer, id: string) => {
      this.events.onPlayerAdded(id, player);
      $(player).onChange(() => this.events.onPlayerChanged(id, player));
    }, true);
    $(room.state).players.onRemove((_player: ReplicatedPlayer, id: string) => this.events.onPlayerRemoved(id));
    $(room.state).seats.onAdd(() => this.events.onSeatsChanged(), true);
    $(room.state).seats.onRemove(() => this.events.onSeatsChanged());
    $(room.state).seats.onChange(() => this.events.onSeatsChanged());
    $(room.state).listen("gameMinute", (minute: number) => this.events.onClock(minute), true);

    this.events.onStatus("connected");
  }

  moveTo(target: MoveToPayload): void {
    this.room?.send(ClientMessage.MoveTo, target);
  }

  moveDirection(direction: MoveDirectionPayload): void {
    this.room?.send(ClientMessage.MoveDirection, direction);
  }

  stop(): void {
    this.room?.send(ClientMessage.Stop);
  }

  interact(request: InteractPayload): void {
    this.room?.send(ClientMessage.Interact, request);
  }

  cancelAction(): void {
    this.room?.send(ClientMessage.CancelAction);
  }

  createCharacter(input: NewCharacterInput): void {
    this.room?.send(ClientMessage.CreateCharacter, input);
  }

  /** In the world: the character being played. At the title screen: `characterId`. */
  updateAppearance(appearance: AppearanceConfig, characterId?: string): void {
    this.room?.send(ClientMessage.UpdateAppearance, characterId ? { appearance, characterId } : { appearance });
  }

  enterWorld(characterId: string): void {
    this.room?.send(ClientMessage.EnterWorld, { characterId });
  }

  leaveWorld(): void {
    this.room?.send(ClientMessage.LeaveWorld);
  }

  deleteCharacter(characterId: string, confirmName: string): void {
    this.room?.send(ClientMessage.DeleteCharacter, { characterId, confirmName });
  }

  /** Asks the server to end this character's job (M7). */
  quitJob(): void {
    this.room?.send(ClientMessage.QuitJob);
  }

  /** Asks for another player's card: your relationship with them (M9). */
  viewProfile(targetId: string): void {
    this.room?.send(ClientMessage.ViewProfile, { targetId });
  }

  block(targetId: string): void {
    this.room?.send(ClientMessage.Block, { targetId });
  }

  unblock(blockId: string): void {
    this.room?.send(ClientMessage.Unblock, { blockId });
  }

  report(targetId: string, reason: ReportReason, note: string): void {
    this.room?.send(ClientMessage.Report, note.trim() ? { targetId, reason, note } : { targetId, reason });
  }

  get joined(): boolean {
    return this.room !== null;
  }

  /** Test hook only (debug builds / ?e2e): closes the socket as a network drop would. */
  simulateDrop(): void {
    if (!this.room) return;
    this.room.reconnection.minUptime = 0;
    this.room.connection.close(4010, "simulated drop");
  }

  /** Consented leave: removes the character for everyone immediately. */
  leave(): void {
    void this.room?.leave(true);
  }
}
