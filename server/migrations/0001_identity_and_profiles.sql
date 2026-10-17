-- M4: guest accounts, character profiles, appearance and saved world state.
-- Each concern has its own table so later systems (inventory, skills,
-- relationships) get their own tables instead of growing one JSON blob.

-- migrate:up

CREATE TABLE accounts (
  id            uuid PRIMARY KEY,
  -- Only temporary guest accounts exist so far (see docs/DECISIONS.md D-017).
  kind          text NOT NULL CHECK (kind IN ('guest')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now()
);

-- Proof of ownership for guest accounts: the SHA-256 hash of a random secret
-- held by the player's browser. The secret itself is never stored.
CREATE TABLE guest_credentials (
  account_id  uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE CHECK (char_length(token_hash) = 64),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE characters (
  id               uuid PRIMARY KEY,
  account_id       uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- The application enforces 2-20 characters; this is a safety net.
  display_name     text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 40),
  age_category     text NOT NULL CHECK (age_category IN ('child', 'teen', 'adult')),
  -- Version of the profile data shape (shared/src/profile.ts PROFILE_VERSION).
  profile_version  integer NOT NULL CHECK (profile_version >= 1),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- One character per account for now. Dropping this index allows several later.
CREATE UNIQUE INDEX characters_one_per_account ON characters (account_id);

-- Appearance option ids are validated against the shared catalogue in code,
-- so adding options never needs a migration; retired ids are repaired on load.
CREATE TABLE character_appearance (
  character_id  uuid PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
  preset        text NOT NULL,
  skin_tone     text NOT NULL,
  hair_style    text NOT NULL,
  hair_colour   text NOT NULL,
  eye_colour    text NOT NULL,
  outfit        text NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Where the character was when last saved.
CREATE TABLE character_state (
  character_id  uuid PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
  area          text NOT NULL DEFAULT 'plaza',
  pos_x         real NOT NULL,
  pos_z         real NOT NULL,
  rotation      real NOT NULL DEFAULT 0,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- migrate:down

DROP TABLE character_state;
DROP TABLE character_appearance;
DROP TABLE characters;
DROP TABLE guest_credentials;
DROP TABLE accounts;
