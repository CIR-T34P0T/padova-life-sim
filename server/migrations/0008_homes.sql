-- M10: a place to live. A character rents one room at a time in the student
-- housing (a home); rent is charged once per game week through the ledger
-- (category 'rent'); furniture is bought from a small catalogue (category
-- 'purchase') and placed in the room's fixed spots, or kept in storage. A new
-- comfort need (Q7). Every row belongs to one character; nothing here is
-- visible to other players.

-- migrate:up

ALTER TABLE character_needs ADD COLUMN comfort real NOT NULL DEFAULT 70 CHECK (comfort BETWEEN 0 AND 100);

ALTER TABLE wallet_transactions DROP CONSTRAINT wallet_transactions_category_check;
ALTER TABLE wallet_transactions ADD CONSTRAINT wallet_transactions_category_check
  CHECK (category IN ('allowance', 'purchase', 'refund', 'wage', 'rent'));

ALTER TABLE story_events DROP CONSTRAINT story_events_kind_check;
ALTER TABLE story_events ADD CONSTRAINT story_events_kind_check
  CHECK (kind IN ('hired', 'first_shift', 'enrolled', 'exam_passed', 'exam_failed', 'new_friend', 'moved_in', 'moved_out', 'rent_trouble'));

-- One row per tenancy. A character has at most one current home (ended_at
-- IS NULL); moving ends the old row and starts a new one, so the history stays.
CREATE TABLE homes (
  id                    uuid PRIMARY KEY,
  character_id          uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  -- Ids from shared/src/life/config.ts ROOM_TYPE_IDS, validated in code.
  room_type             text NOT NULL CHECK (char_length(room_type) BETWEEN 1 AND 32),
  -- The weekly rent agreed when the room was rented.
  rent_cents            integer NOT NULL CHECK (rent_cents >= 0),
  -- Last rent week paid (weeks start on Monday; week 0 is Days 1–7).
  paid_week             integer NOT NULL,
  -- Game minute this week's rent first couldn't be paid; null when up to date.
  overdue_since         double precision,
  -- The first week's rent, charged when the room was rented (makes renting idempotent).
  lease_transaction_id  uuid REFERENCES wallet_transactions(id) ON DELETE SET NULL,
  started_game_minute   double precision NOT NULL,
  started_at            timestamptz NOT NULL DEFAULT now(),
  ended_at              timestamptz,
  end_reason            text CHECK (end_reason IN ('moved', 'moved_out', 'unpaid')),
  CHECK ((ended_at IS NULL) = (end_reason IS NULL))
);

CREATE UNIQUE INDEX homes_one_current ON homes (character_id) WHERE ended_at IS NULL;
CREATE UNIQUE INDEX homes_by_lease ON homes (lease_transaction_id) WHERE lease_transaction_id IS NOT NULL;

-- Furniture a character owns: placed in a spot of their current home, or in
-- storage (home_id and slot both null). The purchase's ledger row makes
-- buying idempotent.
CREATE TABLE furniture (
  id              uuid PRIMARY KEY,
  character_id    uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  -- Ids from shared/src/life/config.ts FURNITURE_IDS, validated in code.
  item_id         text NOT NULL CHECK (char_length(item_id) BETWEEN 1 AND 32),
  home_id         uuid REFERENCES homes(id) ON DELETE SET NULL,
  slot            text CHECK (char_length(slot) BETWEEN 1 AND 32),
  transaction_id  uuid REFERENCES wallet_transactions(id) ON DELETE SET NULL,
  bought_at       timestamptz NOT NULL DEFAULT now(),
  CHECK ((home_id IS NULL) = (slot IS NULL))
);

CREATE UNIQUE INDEX furniture_one_per_slot ON furniture (home_id, slot) WHERE home_id IS NOT NULL;
CREATE UNIQUE INDEX furniture_by_purchase ON furniture (transaction_id) WHERE transaction_id IS NOT NULL;
CREATE INDEX furniture_by_character ON furniture (character_id);

-- migrate:down

-- Refuses, and changes nothing (the migration runs in one transaction), while
-- any home or piece of furniture exists, or any rent payment or new story
-- event is in the ledger or a story: each check below fails if a row matches.
-- Nothing is deleted automatically; remove that data deliberately first.
ALTER TABLE homes ADD CONSTRAINT rollback_refused_while_homes_exist CHECK (false);
ALTER TABLE furniture ADD CONSTRAINT rollback_refused_while_furniture_exists CHECK (false);
ALTER TABLE wallet_transactions DROP CONSTRAINT wallet_transactions_category_check;
ALTER TABLE wallet_transactions ADD CONSTRAINT wallet_transactions_category_check
  CHECK (category IN ('allowance', 'purchase', 'refund', 'wage'));
ALTER TABLE story_events DROP CONSTRAINT story_events_kind_check;
ALTER TABLE story_events ADD CONSTRAINT story_events_kind_check
  CHECK (kind IN ('hired', 'first_shift', 'enrolled', 'exam_passed', 'exam_failed', 'new_friend'));
DROP TABLE furniture;
DROP TABLE homes;
ALTER TABLE character_needs DROP COLUMN comfort;
