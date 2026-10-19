// Which session currently plays each account, across all rooms in this
// process. Policy (docs/DECISIONS.md D-018): the newest session wins; the
// older one is saved, removed from the world and disconnected with close
// code 4100 ("signed in elsewhere").
//
// Single-process only. Running several server processes needs a shared
// registry (e.g. Colyseus presence/Redis); not needed yet.

interface ActiveSession {
  sessionId: string;
  /** The character this session plays (D-031: one at a time per account). */
  characterId: string | null;
  evict: () => Promise<void>;
}

export class SessionRegistry {
  private readonly active = new Map<string, ActiveSession>();

  /**
   * Makes `sessionId` the account's playing session, evicting any other one
   * first. Called when a session enters the world, not when it only looks at
   * the title screen.
   */
  async claim(accountId: string, sessionId: string, evict: () => Promise<void>, characterId: string | null = null): Promise<void> {
    const existing = this.active.get(accountId);
    if (existing && existing.sessionId !== sessionId) await existing.evict();
    this.active.set(accountId, { sessionId, evict, characterId });
  }

  /** The character the account is playing right now, in any room; undefined if none. */
  characterOf(accountId: string): string | undefined {
    return this.active.get(accountId)?.characterId ?? undefined;
  }

  /** Forgets the account's session, but only if it is still `sessionId`. */
  release(accountId: string, sessionId: string): void {
    if (this.active.get(accountId)?.sessionId === sessionId) this.active.delete(accountId);
  }

  sessionOf(accountId: string): string | undefined {
    return this.active.get(accountId)?.sessionId;
  }
}
