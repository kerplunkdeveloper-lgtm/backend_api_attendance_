CREATE TABLE "BiometricCredential" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "cardUid" TEXT NOT NULL,
    "label" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BiometricCredential_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BiometricCredential_organizationId_cardUid_key" ON "BiometricCredential"("organizationId", "cardUid");
CREATE UNIQUE INDEX "BiometricCredential_organizationId_employeeId_key" ON "BiometricCredential"("organizationId", "employeeId");
CREATE INDEX "BiometricCredential_organizationId_idx" ON "BiometricCredential"("organizationId");
CREATE INDEX "BiometricCredential_employeeId_idx" ON "BiometricCredential"("employeeId");

ALTER TABLE "BiometricCredential" ADD CONSTRAINT "BiometricCredential_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BiometricCredential" ADD CONSTRAINT "BiometricCredential_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
