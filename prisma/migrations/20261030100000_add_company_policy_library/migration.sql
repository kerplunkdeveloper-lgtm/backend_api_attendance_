CREATE TABLE "CompanyPolicy" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL DEFAULT 'GENERAL',
    "fileUrl" TEXT NOT NULL,
    "filePublicId" TEXT,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "publishedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "uploadedById" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CompanyPolicy_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CompanyPolicy_organizationId_isPublished_archivedAt_idx" ON "CompanyPolicy"("organizationId", "isPublished", "archivedAt");
CREATE INDEX "CompanyPolicy_organizationId_category_idx" ON "CompanyPolicy"("organizationId", "category");
ALTER TABLE "CompanyPolicy" ADD CONSTRAINT "CompanyPolicy_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompanyPolicy" ADD CONSTRAINT "CompanyPolicy_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CompanyPolicy" ADD CONSTRAINT "CompanyPolicy_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
