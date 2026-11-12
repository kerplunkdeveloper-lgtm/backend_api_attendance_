ALTER TABLE "BiometricCredential" ADD COLUMN "credentialType" TEXT NOT NULL DEFAULT 'CARD_UID';

DROP INDEX "BiometricCredential_organizationId_cardUid_key";
DROP INDEX "BiometricCredential_organizationId_employeeId_key";

CREATE UNIQUE INDEX "BiometricCredential_organizationId_credentialType_cardUid_key" ON "BiometricCredential"("organizationId", "credentialType", "cardUid");
CREATE UNIQUE INDEX "BiometricCredential_organizationId_employeeId_credentialType_key" ON "BiometricCredential"("organizationId", "employeeId", "credentialType");
