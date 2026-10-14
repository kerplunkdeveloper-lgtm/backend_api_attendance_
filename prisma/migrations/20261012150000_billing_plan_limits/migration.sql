CREATE TABLE "BillingPlanLimit" (
    "id" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "maxEmployees" INTEGER NOT NULL,
    "maxBranches" INTEGER NOT NULL,
    "hasGeofence" BOOLEAN NOT NULL DEFAULT true,
    "hasPayroll" BOOLEAN NOT NULL DEFAULT true,
    "hasShiftPlanner" BOOLEAN NOT NULL DEFAULT true,
    "hasApiAccess" BOOLEAN NOT NULL DEFAULT false,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BillingPlanLimit_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BillingPlanLimit_plan_key" ON "BillingPlanLimit"("plan");
INSERT INTO "BillingPlanLimit" ("id", "plan", "maxEmployees", "maxBranches", "hasGeofence", "hasPayroll", "hasShiftPlanner", "hasApiAccess", "updatedAt") VALUES
  (gen_random_uuid()::text, 'STARTER', 25, 2, true, true, true, false, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'PROFESSIONAL', 100, 10, true, true, true, true, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'ENTERPRISE', 10000, 100, true, true, true, true, CURRENT_TIMESTAMP);
