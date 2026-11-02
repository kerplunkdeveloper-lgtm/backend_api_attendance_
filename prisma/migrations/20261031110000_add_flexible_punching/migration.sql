-- Selected employees may punch outside their assigned shift clock window.
ALTER TABLE "Employee"
ADD COLUMN "flexiblePunching" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Shift"
ADD COLUMN "flexiblePunching" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Shift"
ADD COLUMN "totalWorkingMinutes" INTEGER;
