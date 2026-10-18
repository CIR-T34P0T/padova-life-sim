-- M5: personality traits, needs, skills, mood events and money.
-- One table per concern (docs/DATA_MODEL.md). Rules and meanings:
-- docs/GAME_DESIGN.md "Life simulation" and docs/DECISIONS.md D-021 to D-025.

-- migrate:up

CREATE TABLE character_traits (
  character_id  uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  -- Ids from shared/src/life/config.ts TRAIT_IDS, validated in code.
  trait         text NOT NULL CHECK (char_length(trait) BETWEEN 1 AND 32),
  PRIMARY KEY (character_id, trait)
);

-- Needs 0–100. updated_at is when they were last saved: it drives the offline catch-up (D-022).
CREATE TABLE character_needs (
  character_id  uuid PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
  hunger        real NOT NULL CHECK (hunger BETWEEN 0 AND 100),
  energy        real NOT NULL CHECK (energy BETWEEN 0 AND 100),
  hygiene       real NOT NULL CHECK (hygiene BETWEEN 0 AND 100),
  social        real NOT NULL CHECK (social BETWEEN 0 AND 100),
  fun           real NOT NULL CHECK (fun BETWEEN 0 AND 100),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Experience per skill. Levels are derived in code, never stored. Missing row = 0 XP.
CREATE TABLE character_skills (
  character_id  uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  skill         text NOT NULL CHECK (char_length(skill) BETWEEN 1 AND 32),
  xp            double precision NOT NULL CHECK (xp >= 0),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (character_id, skill)
);

-- Recent events that affect mood, with expiry in game minutes. One row per kind.
CREATE TABLE character_mood_events (
  character_id  uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  event         text NOT NULL CHECK (char_length(event) BETWEEN 1 AND 40),
  started_at    double precision NOT NULL,
  expires_at    double precision NOT NULL,
  PRIMARY KEY (character_id, event)
);

-- Money (D-023). The balance can never be negative: there is no debt.
CREATE TABLE character_wallets (
  character_id   uuid PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
  balance_cents  integer NOT NULL CHECK (balance_cents >= 0),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Append-only ledger. request_key makes every money change idempotent.
CREATE TABLE wallet_transactions (
  id                   uuid PRIMARY KEY,
  character_id         uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  direction            text NOT NULL CHECK (direction IN ('income', 'expense')),
  category             text NOT NULL CHECK (category IN ('allowance', 'purchase', 'refund')),
  amount_cents         integer NOT NULL CHECK (amount_cents > 0),
  balance_after_cents  integer NOT NULL CHECK (balance_after_cents >= 0),
  item_id              text,
  description          text NOT NULL CHECK (char_length(description) BETWEEN 1 AND 80),
  request_key          text NOT NULL CHECK (char_length(request_key) BETWEEN 1 AND 100),
  game_minute          double precision NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (character_id, request_key)
);

CREATE INDEX wallet_transactions_recent ON wallet_transactions (character_id, created_at DESC);

-- Existing characters (created before M5) get starting needs (the values of
-- NEEDS_CONFIG.initial when this migration was written), a wallet and the
-- starting allowance as their first ledger entry. Game minute 480 = Day 1 08:00.
INSERT INTO character_needs (character_id, hunger, energy, hygiene, social, fun)
  SELECT id, 80, 80, 80, 70, 70 FROM characters;

INSERT INTO character_wallets (character_id, balance_cents)
  SELECT id, 10000 FROM characters;

INSERT INTO wallet_transactions
  (id, character_id, direction, category, amount_cents, balance_after_cents, description, request_key, game_minute)
  SELECT gen_random_uuid(), id, 'income', 'allowance', 10000, 10000, 'Starting allowance', 'starting-allowance', 480
  FROM characters;

-- migrate:down

-- Destroys all needs, skills, traits, mood events and money. Back up first.
DROP TABLE wallet_transactions;
DROP TABLE character_wallets;
DROP TABLE character_mood_events;
DROP TABLE character_skills;
DROP TABLE character_needs;
DROP TABLE character_traits;
