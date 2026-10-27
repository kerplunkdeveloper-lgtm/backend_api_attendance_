CREATE TABLE "ShootRequestParticipant" (
    "id" TEXT NOT NULL,
    "shootRequestId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ShootRequestParticipant_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ShootRequestParticipant_shootRequestId_employeeId_key" ON "ShootRequestParticipant"("shootRequestId", "employeeId");
CREATE INDEX "ShootRequestParticipant_employeeId_idx" ON "ShootRequestParticipant"("employeeId");
ALTER TABLE "ShootRequestParticipant" ADD CONSTRAINT "ShootRequestParticipant_shootRequestId_fkey" FOREIGN KEY ("shootRequestId") REFERENCES "ShootRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShootRequestParticipant" ADD CONSTRAINT "ShootRequestParticipant_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
INSERT INTO "ShootRequestParticipant" ("id", "shootRequestId", "employeeId")
SELECT gen_random_uuid()::text, sr."id", sr."employeeId"
FROM "ShootRequest" sr
WHERE NOT EXISTS (
  SELECT 1 FROM "ShootRequestParticipant" p WHERE p."shootRequestId" = sr."id" AND p."employeeId" = sr."employeeId"
);