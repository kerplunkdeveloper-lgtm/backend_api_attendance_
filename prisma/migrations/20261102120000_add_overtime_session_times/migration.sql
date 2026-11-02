ALTER TABLE "OvertimeRequest"
  ADD COLUMN "plannedStartTime" TEXT,
  ADD COLUMN "plannedEndTime" TEXT,
  ADD COLUMN "otCheckIn" TIMESTAMP(3),
  ADD COLUMN "otCheckOut" TIMESTAMP(3);

CREATE INDEX "OvertimeRequest_attendanceId_status_idx"
  ON "OvertimeRequest"("attendanceId", "status");
