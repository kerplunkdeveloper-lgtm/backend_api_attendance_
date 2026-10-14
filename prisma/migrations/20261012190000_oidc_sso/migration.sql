ALTER TABLE "Organization"
  ADD COLUMN "ssoEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "ssoIssuer" TEXT,
  ADD COLUMN "ssoClientId" TEXT,
  ADD COLUMN "ssoClientSecretCiphertext" TEXT,
  ADD COLUMN "ssoEmailDomain" TEXT;

CREATE TABLE "SsoLoginCode" (
  "id" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SsoLoginCode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SsoLoginCode_codeHash_key" ON "SsoLoginCode"("codeHash");
CREATE INDEX "SsoLoginCode_organizationId_expiresAt_idx" ON "SsoLoginCode"("organizationId", "expiresAt");
CREATE INDEX "SsoLoginCode_userId_expiresAt_idx" ON "SsoLoginCode"("userId", "expiresAt");
ALTER TABLE "SsoLoginCode" ADD CONSTRAINT "SsoLoginCode_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SsoLoginCode" ADD CONSTRAINT "SsoLoginCode_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
