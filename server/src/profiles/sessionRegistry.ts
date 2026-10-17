// Which session currently plays each account, across all rooms in this
// process. Policy (docs/DECISIONS.md D-018): the newest session wins; the
// older one is saved, removed from the world and disconnected with close
// code 4100 ("signed in elsewhere").
//
// Single-process only. Running several server processes needs a shared
// registry (e.g. Colyseus presence/Redis); not needed yet.

interface ActiveSession {
  sessionId: string;
  evict: () => Promise<void>;
}

export class SessionRegistry {
  private readonly active = new Map<string, ActiveSession>();

  /** Makes `sessionId` the account's session, evicting any other one first. */
  async claim(accountId: string, sessionId: string, evict: () => Promise<void>): Promise<void> {
    const existing = this.active.get(accountId);
    if (existing && existing.sessionId !== sessionId) await existing.evict();
    this.active.set(accountId, { sessionId, evict });
  }

  /** Forgets the account's session, but only if it is still `sessionId`. */
  release(accountId: string, sessionId: string): void {
    if (this.active.get(accountId)?.sessionId === sessionId) this.active.delete(accountId);
  }

  sessionOf(accountId: string): string | undefined {
    return this.active.get(accountId)?.sessionId;
  }
}
