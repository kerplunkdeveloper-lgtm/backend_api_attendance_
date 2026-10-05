CREATE TABLE "BillingPlanPrice" (
    "id" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "billingCycle" TEXT NOT NULL,
    "priceInr" DECIMAL(12,2) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BillingPlanPrice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BillingPlanPrice_plan_billingCycle_key" ON "BillingPlanPrice"("plan", "billingCycle");
CREATE INDEX "BillingPlanPrice_plan_isActive_idx" ON "BillingPlanPrice"("plan", "isActive");

CREATE TABLE "BillingOffer" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" DECIMAL(12,2) NOT NULL,
    "maxDiscountInr" DECIMAL(12,2),
    "eligiblePlans" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "eligibleCycles" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "firstPaidOrderOnly" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BillingOffer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BillingOffer_code_key" ON "BillingOffer"("code");
CREATE INDEX "BillingOffer_isActive_startsAt_expiresAt_idx" ON "BillingOffer"("isActive", "startsAt", "expiresAt");

INSERT INTO "BillingPlanPrice" ("id", "plan", "billingCycle", "priceInr", "updatedAt") VALUES
  (gen_random_uuid()::text, 'STARTER', 'MONTHLY', 2499, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'STARTER', 'ANNUAL', 24990, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'PROFESSIONAL', 'MONTHLY', 6999, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'PROFESSIONAL', 'ANNUAL', 69990, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'ENTERPRISE', 'MONTHLY', 16999, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'ENTERPRISE', 'ANNUAL', 169990, CURRENT_TIMESTAMP);

INSERT INTO "BillingOffer" ("id", "code", "label", "type", "value", "maxDiscountInr", "eligibleCycles", "firstPaidOrderOnly", "updatedAt") VALUES
  (gen_random_uuid()::text, 'WELCOME20', '20% off your first paid billing period', 'PERCENTAGE', 20, 2000, ARRAY[]::TEXT[], true, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'ANNUAL20', '20% off annual billing', 'PERCENTAGE', 20, NULL, ARRAY['ANNUAL'], false, CURRENT_TIMESTAMP);
