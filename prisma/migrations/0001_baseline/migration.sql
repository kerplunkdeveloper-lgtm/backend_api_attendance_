-- 0001_baseline is retained so existing Prisma migration history stays ordered.
-- The objects it previously created are applied by 20260909071503_initial_schema
-- and later incremental migrations. Running both CREATE scripts on an empty
-- database failed with duplicate types/tables.
--
-- This file is intentionally a no-op. Do not restore the original CREATE
-- statements here. If a deployed database already recorded this migration
-- with a different checksum, inspect `_prisma_migrations` before resolving
-- (`prisma migrate resolve`) — never reset production to "fix" history.
SELECT 1;
