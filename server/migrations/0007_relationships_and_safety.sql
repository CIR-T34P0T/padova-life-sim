-- M9: relationships, blocks, reports and the story log.
-- Relationships are between characters (one row per pair, the two ids in a
-- fixed order) with a short history of shared moments. Blocks and reports
-- are between accounts, so they carry over when a guest signs in (D-042).
-- Report details are deleted after 90 days by the server (D-042). Story
-- events are a character's private log, written by the server.
-- Rules and numbers: docs/GAME_DESIGN.md "Relationships (M9)" and "Safety
-- (M9)"; tuning in shared/src/life/config.ts and shared/src/config.ts.

-- migrate:up

CREATE TABLE relationships (
  character_low       uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  character_high      uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  score               integer NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 100),
  first_game_minute   double precision NOT NULL,
  last_game_minute    double precision NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (character_low, character_high),
  CHECK (character_low < character_high)
);

CREATE INDEX relationships_by_high ON relationships (character_high);

-- Shared moments that counted (over the daily cap they are not written);
-- only the newest few per pair are kept.
CREATE TABLE relationship_events (
  id              uuid PRIMARY KEY,
  character_low   uuid NOT NULL,
  character_high  uuid NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('greet', 'chat', 'study_together', 'lecture_together')),
  game_day        integer NOT NULL CHECK (game_day >= 1),
  game_minute     double precision NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (character_low, character_high) REFERENCES relationships (character_low, character_high) ON DELETE CASCADE
);

CREATE INDEX relationship_events_by_pair ON relationship_events (character_low, character_high, game_minute DESC);

-- An account blocking another. The character name is kept for the blocker's
-- list; the block covers the whole blocked account.
CREATE TABLE blocks (
  id                    uuid PRIMARY KEY,
  blocker_account       uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  blocked_account       uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  blocked_character_id  uuid REFERENCES characters(id) ON DELETE SET NULL,
  blocked_name          text NOT NULL CHECK (char_length(blocked_name) BETWEEN 1 AND 40),
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (blocker_account, blocked_account),
  CHECK (blocker_account <> blocked_account)
);

-- Player reports with minimal context, read by the product owner. The
-- reporter's link is cleared if their account is deleted; a report goes away
-- with the reported account. Rows older than 90 days are deleted.
CREATE TABLE reports (
  id                     uuid PRIMARY KEY,
  reporter_account       uuid REFERENCES accounts(id) ON DELETE SET NULL,
  reporter_character_id  uuid REFERENCES characters(id) ON DELETE SET NULL,
  reporter_name          text NOT NULL CHECK (char_length(reporter_name) BETWEEN 1 AND 40),
  reported_account       uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  reported_character_id  uuid REFERENCES characters(id) ON DELETE SET NULL,
  reported_name          text NOT NULL CHECK (char_length(reported_name) BETWEEN 1 AND 40),
  reason                 text NOT NULL CHECK (reason IN ('harassment', 'hate', 'offensive_name', 'cheating', 'other')),
  note                   text CHECK (char_length(note) <= 300),
  area                   text NOT NULL CHECK (char_length(area) BETWEEN 1 AND 64),
  game_minute            double precision NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX reports_by_reporter ON reports (reporter_account, created_at DESC);
CREATE INDEX reports_by_age ON reports (created_at);

-- A character's private story log. The event key makes each write
-- idempotent (e.g. 'first_shift', 'exam:city-studies:d13', 'friend:<id>').
CREATE TABLE story_events (
  id            uuid PRIMARY KEY,
  character_id  uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  event_key     text NOT NULL CHECK (char_length(event_key) BETWEEN 1 AND 80),
  kind          text NOT NULL CHECK (kind IN ('hired', 'first_shift', 'enrolled', 'exam_passed', 'exam_failed', 'new_friend')),
  game_minute   double precision NOT NULL,
  details       jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object' AND octet_length(details::text) <= 512),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (character_id, event_key)
);

CREATE INDEX story_events_by_character ON story_events (character_id, game_minute DESC);

-- migrate:down

-- Refuses, and changes nothing (the migration runs in one transaction),
-- while any relationship, block, report or story event exists: each check
-- below fails if its table has a row. Nothing is deleted automatically;
-- remove that data deliberately before rolling back.
ALTER TABLE relationships ADD CONSTRAINT rollback_refused_while_relationships_exist CHECK (false);
ALTER TABLE blocks ADD CONSTRAINT rollback_refused_while_blocks_exist CHECK (false);
ALTER TABLE reports ADD CONSTRAINT rollback_refused_while_reports_exist CHECK (false);
ALTER TABLE story_events ADD CONSTRAINT rollback_refused_while_story_exists CHECK (false);
DROP TABLE story_events;
DROP TABLE reports;
DROP TABLE blocks;
DROP TABLE relationship_events;
DROP TABLE relationships;
