ALTER TABLE "Organization"
  ADD COLUMN IF NOT EXISTS "logoStorageProvider" TEXT NOT NULL DEFAULT 'cloudinary',
  ADD COLUMN IF NOT EXISTS "logoStorageKey" TEXT;

ALTER TABLE "ExpenseClaim"
  ADD COLUMN IF NOT EXISTS "receiptStorageProvider" TEXT NOT NULL DEFAULT 'cloudinary',
  ADD COLUMN IF NOT EXISTS "receiptStorageKey" TEXT;

ALTER TABLE "OnboardingDocument"
  ADD COLUMN IF NOT EXISTS "storageProvider" TEXT NOT NULL DEFAULT 'cloudinary',
  ADD COLUMN IF NOT EXISTS "storageKey" TEXT;

ALTER TABLE "OnboardingDocument"
  ALTER COLUMN "fileUrl" DROP NOT NULL;
