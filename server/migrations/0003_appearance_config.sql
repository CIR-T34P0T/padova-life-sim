-- M6: the character appearance becomes one versioned JSON document
-- (docs/DECISIONS.md D-028, shape in shared/src/appearance/schema.ts).
-- Validated in code before every write; the column is only storage.
--
-- The six M4 columns stay and keep being written with the closest old
-- option (legacyAppearanceProjection), so a rollback leaves every character
-- loadable by the M5 server with a similar look.

-- migrate:up

ALTER TABLE character_appearance
  ADD COLUMN config jsonb CHECK (config IS NULL OR (jsonb_typeof(config) = 'object' AND pg_column_size(config) < 4096));

-- migrate:down

-- Characters saved by the M6 server (profile version 3) go back to version 2;
-- their M4 columns already hold the closest old look.
UPDATE characters SET profile_version = 2 WHERE profile_version = 3;
ALTER TABLE character_appearance DROP COLUMN config;
