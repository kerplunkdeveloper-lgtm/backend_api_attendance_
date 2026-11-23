CREATE TABLE "AIConversation" (
  "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "userId" TEXT NOT NULL,
  "title" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, "deletedAt" TIMESTAMP(3),
  CONSTRAINT "AIConversation_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "AIMessage" (
  "id" TEXT NOT NULL, "conversationId" TEXT NOT NULL, "organizationId" TEXT NOT NULL,
  "role" TEXT NOT NULL, "content" TEXT NOT NULL, "toolName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AIMessage_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "AIKnowledgeDocument" (
  "id" TEXT NOT NULL, "organizationId" TEXT, "uploadedById" TEXT, "title" TEXT NOT NULL,
  "category" TEXT NOT NULL DEFAULT 'GENERAL', "sourceType" TEXT NOT NULL DEFAULT 'TEXT',
  "fileName" TEXT, "content" TEXT NOT NULL, "isPublished" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  "archivedAt" TIMESTAMP(3), CONSTRAINT "AIKnowledgeDocument_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "AIUsageRecord" (
  "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "userId" TEXT NOT NULL, "conversationId" TEXT,
  "model" TEXT NOT NULL, "inputTokens" INTEGER NOT NULL DEFAULT 0, "outputTokens" INTEGER NOT NULL DEFAULT 0,
  "estimatedCost" DECIMAL(12,6) NOT NULL DEFAULT 0, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AIUsageRecord_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "AIToolAuditLog" (
  "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "userId" TEXT NOT NULL, "conversationId" TEXT,
  "toolName" TEXT NOT NULL, "inputSummary" JSONB, "success" BOOLEAN NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "AIToolAuditLog_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "AIOrganizationSettings" (
  "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "enabled" BOOLEAN NOT NULL DEFAULT true,
  "monthlyBudget" DECIMAL(12,6), "retentionDays" INTEGER NOT NULL DEFAULT 90,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AIOrganizationSettings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AIOrganizationSettings_organizationId_key" ON "AIOrganizationSettings"("organizationId");
CREATE INDEX "AIConversation_organizationId_userId_updatedAt_idx" ON "AIConversation"("organizationId","userId","updatedAt");
CREATE INDEX "AIConversation_userId_deletedAt_idx" ON "AIConversation"("userId","deletedAt");
CREATE INDEX "AIMessage_conversationId_createdAt_idx" ON "AIMessage"("conversationId","createdAt");
CREATE INDEX "AIKnowledgeDocument_organizationId_isPublished_archivedAt_idx" ON "AIKnowledgeDocument"("organizationId","isPublished","archivedAt");
CREATE INDEX "AIUsageRecord_organizationId_createdAt_idx" ON "AIUsageRecord"("organizationId","createdAt");
CREATE INDEX "AIToolAuditLog_organizationId_createdAt_idx" ON "AIToolAuditLog"("organizationId","createdAt");
ALTER TABLE "AIConversation" ADD CONSTRAINT "AIConversation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AIConversation" ADD CONSTRAINT "AIConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AIMessage" ADD CONSTRAINT "AIMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AIConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AIMessage" ADD CONSTRAINT "AIMessage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AIKnowledgeDocument" ADD CONSTRAINT "AIKnowledgeDocument_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AIKnowledgeDocument" ADD CONSTRAINT "AIKnowledgeDocument_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AIUsageRecord" ADD CONSTRAINT "AIUsageRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AIUsageRecord" ADD CONSTRAINT "AIUsageRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AIUsageRecord" ADD CONSTRAINT "AIUsageRecord_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AIConversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AIToolAuditLog" ADD CONSTRAINT "AIToolAuditLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AIToolAuditLog" ADD CONSTRAINT "AIToolAuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AIOrganizationSettings" ADD CONSTRAINT "AIOrganizationSettings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
