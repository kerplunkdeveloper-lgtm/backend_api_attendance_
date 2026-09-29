const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { mockPrisma } = require("./helpers/mockPrisma");

let createdData;

mockPrisma({
  organization: {
    findUnique: async () => ({ timezone: "UTC" }),
  },
  employee: {
    findFirst: async () => ({ id: "emp-1" }),
  },
  payslip: {
    findFirst: async () => null,
  },
  attendanceCorrection: {
    findFirst: async () => null,
    create: async ({ data }) => {
      createdData = data;
      return { id: "correction-1", ...data };
    },
  },
});

const correctionService = require("../src/services/correction.service");

describe("attendance correction", () => {
  it("stores complete requested punch timestamps", async () => {
    await correctionService.createCorrectionRequest("user-1", "org-1", {
      attendanceId: "attendance-1",
      date: "2026-09-29T00:00:00.000Z",
      requestedCheckIn: "2026-09-29T03:30:00.000Z",
      requestedCheckOut: "2026-09-29T12:30:00.000Z",
      reason: "  Biometric terminal was offline  ",
    });

    assert.equal(createdData.requestedCheckIn.toISOString(), "2026-09-29T03:30:00.000Z");
    assert.equal(createdData.requestedCheckOut.toISOString(), "2026-09-29T12:30:00.000Z");
    assert.equal(createdData.reason, "Biometric terminal was offline");
  });

  it("rejects bare HTML time values with a useful 400 error", async () => {
    await assert.rejects(
      () =>
        correctionService.createCorrectionRequest("user-1", "org-1", {
          date: "2026-09-29",
          requestedCheckIn: "09:30",
          reason: "Missed punch",
        }),
      (error) => {
        assert.equal(error.statusCode, 400);
        assert.match(error.message, /requestedCheckIn must be a complete ISO date-time/);
        return true;
      },
    );
  });
});
