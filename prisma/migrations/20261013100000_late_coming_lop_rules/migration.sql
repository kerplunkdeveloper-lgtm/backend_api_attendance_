CREATE TABLE "LateComingLopRule" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "lateDays" INTEGER NOT NULL,
  "lopDays" DECIMAL(4,1) NOT NULL,
  "graceMinutes" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "remarks" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LateComingLopRule_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LateComingLopRule_organizationId_lateDays_key" ON "LateComingLopRule"("organizationId", "lateDays");
CREATE INDEX "LateComingLopRule_organizationId_isActive_idx" ON "LateComingLopRule"("organizationId", "isActive");

ALTER TABLE "LateComingLopRule" ADD CONSTRAINT "LateComingLopRule_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;