ALTER TABLE "BillingOrder"
  ADD COLUMN IF NOT EXISTS "baseAmountInr" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "discountAmountInr" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "taxAmountInr" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "couponCode" TEXT;

CREATE INDEX IF NOT EXISTS "BillingOrder_organizationId_couponCode_idx"
  ON "BillingOrder"("organizationId", "couponCode");
