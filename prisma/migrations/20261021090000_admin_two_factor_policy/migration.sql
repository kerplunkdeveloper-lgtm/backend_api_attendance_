-- Workspace policy: company admins must enable two-step verification.
ALTER TABLE "Organization" ADD COLUMN "requireAdminTwoFactor" BOOLEAN NOT NULL DEFAULT false;
