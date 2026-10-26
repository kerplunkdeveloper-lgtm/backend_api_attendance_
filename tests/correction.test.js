const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { mockPrisma } = require("./helpers/mockPrisma");

let createdData;
let orgTimezone = "UTC";

mockPrisma({
  organization: {
    findUnique: async () => ({ timezone: orgTimezone }),
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

describe("attendance correction request rules", () => {
  const base = { reason: "Forgot to punch" };

  it("keeps the calendar day it was sent for, in any timezone", async () => {
    // A tenant behind UTC: converting 2026-09-29T00:00Z into its own zone would move the request to the 28th.
    orgTimezone = "America/New_York";
    await correctionService.createCorrectionRequest("user-1", "org-ny", {
      ...base,
      date: "2026-09-29T00:00:00.000Z",
      requestedCheckIn: "2026-09-29T13:30:00.000Z",
    });
    assert.equal(createdData.date.toISOString(), "2026-09-29T00:00:00.000Z");
  });

  it("needs at least a punch-in or a punch-out time", async () => {
    await assert.rejects(
      () => correctionService.createCorrectionRequest("user-1", "org-1", { ...base, date: "2026-09-29" }),
      (e) => e.statusCode === 400 && /punch-in time, punch-out time, or both/.test(e.message),
    );
  });

  it("rejects a punch-out that is not after the punch-in", async () => {
    await assert.rejects(
      () =>
        correctionService.createCorrectionRequest("user-1", "org-1", {
          ...base,
          date: "2026-09-29",
          requestedCheckIn: "2026-09-29T12:00:00.000Z",
          requestedCheckOut: "2026-09-29T09:00:00.000Z",
        }),
      (e) => e.statusCode === 400 && /after punch-in/.test(e.message),
    );
  });

  it("rejects a date in the future", async () => {
    await assert.rejects(
      () =>
        correctionService.createCorrectionRequest("user-1", "org-1", {
          ...base,
          date: "2999-01-01",
          requestedCheckIn: "2999-01-01T09:00:00.000Z",
        }),
      (e) => e.statusCode === 400 && /today or an earlier date/.test(e.message),
    );
  });
});
