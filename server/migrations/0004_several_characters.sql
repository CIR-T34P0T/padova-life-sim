-- Title screen: a guest profile may hold several characters ("lives"),
-- chosen at the title screen (docs/DECISIONS.md D-031). The limit
-- (PROFILE_CONFIG.maxCharactersPerAccount) is enforced in code, inside the
-- creating transaction, because it is a tuning value rather than a rule of
-- the data. Every per-character table already cascades from characters, so
-- deleting a character removes its life data, money ledger and position.

-- migrate:up

DROP INDEX characters_one_per_account;
CREATE INDEX characters_by_account ON characters (account_id, created_at);

-- migrate:down

-- Fails, and changes nothing, if any profile holds more than one character:
-- delete the extra characters deliberately before rolling back. Nothing is
-- deleted automatically.
DROP INDEX characters_by_account;
CREATE UNIQUE INDEX characters_one_per_account ON characters (account_id);
