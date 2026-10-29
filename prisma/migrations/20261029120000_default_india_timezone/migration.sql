-- New workspaces use the product's India-first timezone. Existing explicit
-- timezone choices are preserved; admins can change them in Settings.
ALTER TABLE "Organization" ALTER COLUMN "timezone" SET DEFAULT 'Asia/Kolkata';

-- UTC was the old implicit default. INR workspaces are the India-first
-- workspaces created before timezone selection was available; preserve all
-- other explicitly configured regions.
UPDATE "Organization"
SET "timezone" = 'Asia/Kolkata'
WHERE "timezone" = 'UTC'
  AND "currency" = 'INR';
