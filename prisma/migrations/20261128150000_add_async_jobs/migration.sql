CREATE TABLE "AsyncJob" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "payload" JSONB NOT NULL,
    "result" JSONB,
    "error" TEXT,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AsyncJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AsyncJob_organizationId_createdAt_idx" ON "AsyncJob"("organizationId", "createdAt");
CREATE INDEX "AsyncJob_organizationId_status_createdAt_idx" ON "AsyncJob"("organizationId", "status", "createdAt");
CREATE INDEX "AsyncJob_userId_createdAt_idx" ON "AsyncJob"("userId", "createdAt");

ALTER TABLE "AsyncJob" ADD CONSTRAINT "AsyncJob_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AsyncJob" ADD CONSTRAINT "AsyncJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AIKnowledgeDocument" ADD COLUMN "embedding" JSONB;
ALTER TABLE "AIKnowledgeDocument" ADD COLUMN "embeddingModel" TEXT;
