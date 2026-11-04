-- The initial shoot settlement migration created the table without the
-- employee-entered shoot start/end timestamps used by the Prisma model.
ALTER TABLE "ShootSettlement"
  ADD COLUMN IF NOT EXISTS "shootStart" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "shootEnd" TIMESTAMP(3);
