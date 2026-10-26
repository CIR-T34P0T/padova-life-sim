-- M7: a first job. One job per character (character_employment) and one row
-- per completed, paid shift (work_shifts). Wages go through the money ledger
-- like every other change (D-023), so the ledger's category list gains
-- 'wage'. Rules and numbers: docs/GAME_DESIGN.md "Work (M7)"; the job
-- catalogue (jobs, grades, wages) is data in shared/src/life/config.ts.

-- migrate:up

ALTER TABLE wallet_transactions DROP CONSTRAINT wallet_transactions_category_check;
ALTER TABLE wallet_transactions ADD CONSTRAINT wallet_transactions_category_check
  CHECK (category IN ('allowance', 'purchase', 'refund', 'wage'));

-- The character's current job. Quitting deletes the row; the shift history stays.
CREATE TABLE character_employment (
  character_id       uuid PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
  -- Ids from shared/src/life/config.ts JOB_IDS, validated in code.
  job                text NOT NULL CHECK (char_length(job) BETWEEN 1 AND 32),
  hired_game_minute  double precision NOT NULL,
  hired_at           timestamptz NOT NULL DEFAULT now()
);

-- Completed shifts only: a cancelled, interrupted or dropped shift is never
-- written and never paid. The id is the shift id chosen by the server; the
-- wage's ledger key is 'wage:<id>', so a shift is paid at most once.
CREATE TABLE work_shifts (
  id                   uuid PRIMARY KEY,
  character_id         uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  job                  text NOT NULL CHECK (char_length(job) BETWEEN 1 AND 32),
  grade                text NOT NULL CHECK (char_length(grade) BETWEEN 1 AND 32),
  game_day             integer NOT NULL CHECK (game_day >= 1),
  started_game_minute  double precision NOT NULL,
  ended_game_minute    double precision NOT NULL CHECK (ended_game_minute >= started_game_minute),
  wage_cents           integer NOT NULL CHECK (wage_cents > 0),
  transaction_id       uuid NOT NULL UNIQUE REFERENCES wallet_transactions(id) ON DELETE CASCADE,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX work_shifts_by_day ON work_shifts (character_id, game_day);

-- migrate:down

-- Refuses, and changes nothing (the migration runs in one transaction), while
-- M7 data exists: the first statement pair fails if any wage was ever paid,
-- the third if any character has a job. Nothing is deleted automatically;
-- remove that data deliberately before rolling back.
ALTER TABLE wallet_transactions DROP CONSTRAINT wallet_transactions_category_check;
ALTER TABLE wallet_transactions ADD CONSTRAINT wallet_transactions_category_check
  CHECK (category IN ('allowance', 'purchase', 'refund'));
ALTER TABLE character_employment ADD CONSTRAINT rollback_refused_while_characters_have_jobs CHECK (false);
DROP TABLE work_shifts;
DROP TABLE character_employment;
