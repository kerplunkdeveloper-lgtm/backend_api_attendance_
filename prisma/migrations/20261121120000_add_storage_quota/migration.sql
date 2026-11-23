ALTER TABLE "Organization"
  ADD COLUMN "storageUsedBytes" DECIMAL(20,0) NOT NULL DEFAULT 0;

-- Seed the counter from legacy metadata so existing workspaces are not treated
-- as empty when the quota is first enabled. New uploads are tracked in
-- StorageObject below.
UPDATE "Organization" o
SET "storageUsedBytes" =
  COALESCE((SELECT SUM("fileSize") FROM "EmployeeDocument" d WHERE d."organizationId" = o.id), 0)
  + COALESCE((SELECT SUM(d."fileSize") FROM "OnboardingDocument" d JOIN "OnboardingCandidate" c ON c.id = d."candidateId" WHERE c."organizationId" = o.id), 0)
  + COALESCE((SELECT SUM("fileSize") FROM "CompanyPolicy" p WHERE p."organizationId" = o.id), 0);

CREATE TABLE "StorageObject" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL,
  "bytes" INTEGER NOT NULL,
  "mimeType" TEXT,
  "purpose" TEXT NOT NULL DEFAULT 'upload',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StorageObject_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StorageObject_provider_storageKey_key" ON "StorageObject"("provider", "storageKey");
CREATE INDEX "StorageObject_organizationId_purpose_idx" ON "StorageObject"("organizationId", "purpose");
ALTER TABLE "StorageObject" ADD CONSTRAINT "StorageObject_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
