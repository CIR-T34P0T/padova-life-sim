// Keeps this browser's TEMPORARY guest token (see docs/DECISIONS.md D-017).
// The token is the only proof of the guest account: clearing site data loses
// the character, and anyone who copies it can play as this guest.

const KEY = "padova.guestToken.v1";

export interface IdentityStore {
  /** False when the browser refuses storage (e.g. some private modes). */
  readonly available: boolean;
  get(): string | null;
  set(token: string): boolean;
  clear(): void;
}

export function createIdentityStore(storage: Storage | null = safeLocalStorage()): IdentityStore {
  return {
    available: storage !== null,
    get() {
      try {
        return storage?.getItem(KEY) ?? null;
      } catch {
        return null;
      }
    },
    set(token) {
      try {
        storage?.setItem(KEY, token);
        return storage !== null;
      } catch {
        return false;
      }
    },
    clear() {
      try {
        storage?.removeItem(KEY);
      } catch {
        // Nothing to clear if storage is unavailable.
      }
    },
  };
}

function safeLocalStorage(): Storage | null {
  try {
    const storage = window.localStorage;
    const probe = "__padova_probe__";
    storage.setItem(probe, "1");
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}
