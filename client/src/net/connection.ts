// Network layer: joins the plaza room, turns replicated state into simple
// events for the rest of the client, and sends intents. No game rules live
// here; the server decides outcomes.

import { Client, getStateCallbacks, type Room } from "@colyseus/sdk";
import {
  ClientMessage,
  ROOM_NAME,
  ServerMessage,
  type ActionUpdatePayload,
  type GreetedPayload,
  type InteractPayload,
  type JoinOptions,
  type MoveDirectionPayload,
  type MoveToPayload,
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
  hue: number;
  activity: string;
  seatId: string;
  targetId: string;
}

export interface ConnectionEvents {
  onStatus(status: ConnectionStatus, detail?: string): void;
  onPlayerAdded(id: string, player: ReplicatedPlayer): void;
  onPlayerChanged(id: string, player: ReplicatedPlayer): void;
  onPlayerRemoved(id: string): void;
  onSeatsChanged(): void;
  onRejected(payload: RejectedPayload): void;
  onActionUpdate(payload: ActionUpdatePayload): void;
  onGreeted(payload: GreetedPayload): void;
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

  async join(options: JoinOptions): Promise<void> {
    this.events.onStatus("connecting");
    const client = new Client(resolveServerUrl());
    const room = await client.joinOrCreate(ROOM_NAME, options);
    this.room = room;

    room.onDrop(() => this.events.onStatus("reconnecting"));
    room.onReconnect(() => this.events.onStatus("connected"));
    room.onLeave((code, reason) => {
      this.events.onStatus("disconnected", reason ? `${reason} (${code})` : `code ${code}`);
    });
    room.onError((code, message) => this.events.onStatus("disconnected", message ?? `error ${code}`));
    room.onMessage(ServerMessage.Rejected, (payload: RejectedPayload) => this.events.onRejected(payload));
    room.onMessage(ServerMessage.ActionUpdate, (payload: ActionUpdatePayload) => this.events.onActionUpdate(payload));
    room.onMessage(ServerMessage.Greeted, (payload: GreetedPayload) => this.events.onGreeted(payload));

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

  /** Consented leave: removes the character for everyone immediately. */
  leave(): void {
    void this.room?.leave(true);
  }
}
