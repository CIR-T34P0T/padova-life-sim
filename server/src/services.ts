// Services shared by the rooms of one game server (database-backed profiles,
// session registry). Rooms receive a key in their options and look the
// services up here, so live objects are never passed through room options.

import type { LifeService } from "./life/LifeService.ts";
import type { ProfileService } from "./profiles/ProfileService.ts";
import type { SessionRegistry } from "./profiles/sessionRegistry.ts";
import type { StatusSource } from "./status.ts";

export interface GameServices {
  profiles: ProfileService;
  life: LifeService;
  sessions: SessionRegistry;
  /** The rooms running on this server, for /status (M12). */
  rooms: Set<StatusSource>;
}

const registry = new Map<string, GameServices>();
let counter = 0;

export function registerServices(services: GameServices): string {
  const key = `services-${++counter}`;
  registry.set(key, services);
  return key;
}

export function getServices(key: string | undefined): GameServices {
  const services = key ? registry.get(key) : undefined;
  if (!services) throw new Error(`Game services "${key}" are not registered`);
  return services;
}

export function unregisterServices(key: string): void {
  registry.delete(key);
}
