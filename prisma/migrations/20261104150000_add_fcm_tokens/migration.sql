CREATE TABLE "FcmToken" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userAgent" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FcmToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FcmToken_token_key" ON "FcmToken"("token");
CREATE INDEX "FcmToken_organizationId_userId_idx" ON "FcmToken"("organizationId", "userId");
CREATE INDEX "FcmToken_userId_lastSeenAt_idx" ON "FcmToken"("userId", "lastSeenAt");

ALTER TABLE "FcmToken" ADD CONSTRAINT "FcmToken_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FcmToken" ADD CONSTRAINT "FcmToken_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
