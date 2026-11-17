-- Add storage metadata without changing existing Cloudinary records.
ALTER TABLE "EmployeeDocument"
ADD COLUMN "storageKey" TEXT,
ADD COLUMN "storageProvider" TEXT NOT NULL DEFAULT 'cloudinary';