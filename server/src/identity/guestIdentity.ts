// TEMPORARY guest identity (see docs/DECISIONS.md D-017).
//
// A guest account is proven by a random 256-bit secret ("guest token") that
// the server generates once and the browser keeps. The server stores only its
// SHA-256 hash. Whoever holds the token controls the account: there is no
// password, no recovery and no second device. This is a stand-in until real
// sign-in exists and must not be presented as an account system.

import { createHash, randomBytes } from "node:crypto";

const PREFIX = "plsg1_";
const TOKEN_PATTERN = /^plsg1_[A-Za-z0-9_-]{43}$/;

export function generateGuestToken(): string {
  return PREFIX + randomBytes(32).toString("base64url");
}

/** Cheap shape check before touching the database; rejects junk early. */
export function isWellFormedGuestToken(token: unknown): token is string {
  return typeof token === "string" && TOKEN_PATTERN.test(token);
}

/**
 * The token is high-entropy random data, so a fast hash is appropriate (no
 * password stretching needed) and lookups can use an index.
 */
export function hashGuestToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
