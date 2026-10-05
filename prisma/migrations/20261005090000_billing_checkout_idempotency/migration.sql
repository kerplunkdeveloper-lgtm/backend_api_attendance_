ALTER TABLE "BillingOrder"
  ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "BillingOrder_organizationId_idempotencyKey_key"
  ON "BillingOrder"("organizationId", "idempotencyKey");
