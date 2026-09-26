-- SaaS readiness: payment identity, loan ledger, API key scopes, portal expiry.

ALTER TABLE "OnboardingCandidate" ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3);
ALTER TABLE "OnboardingCandidate" ADD COLUMN IF NOT EXISTS "revokedAt" TIMESTAMP(3);

ALTER TABLE "OrgApiKey" ADD COLUMN IF NOT EXISTS "scopes" TEXT NOT NULL DEFAULT 'read:employees,read:attendance,read:reports,read:payroll,write:attendance';

ALTER TABLE "Payslip" ADD COLUMN IF NOT EXISTS "loanRecovery" DECIMAL(10,2) NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS "BillingOrder_razorpayPaymentId_key" ON "BillingOrder"("razorpayPaymentId");

CREATE TABLE IF NOT EXISTS "LoanRepayment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'PAYROLL',
    "payslipId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoanRepayment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "LoanRepayment_loanId_year_month_source_key" ON "LoanRepayment"("loanId", "year", "month", "source");
CREATE INDEX IF NOT EXISTS "LoanRepayment_organizationId_employeeId_idx" ON "LoanRepayment"("organizationId", "employeeId");

DO $$ BEGIN
  ALTER TABLE "LoanRepayment" ADD CONSTRAINT "LoanRepayment_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "LoanAdvance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "BillingEvent" (
    "id" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "organizationId" TEXT,
    "orderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BillingEvent_providerEventId_key" ON "BillingEvent"("providerEventId");
CREATE INDEX IF NOT EXISTS "BillingEvent_organizationId_idx" ON "BillingEvent"("organizationId");

DO $$ BEGIN
  ALTER TABLE "BillingEvent" ADD CONSTRAINT "BillingEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "AttendanceEvent" ADD COLUMN IF NOT EXISTS "clientEventId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "AttendanceEvent_clientEventId_key" ON "AttendanceEvent"("clientEventId");
