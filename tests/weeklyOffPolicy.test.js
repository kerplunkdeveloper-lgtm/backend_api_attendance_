const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { mockPrisma } = require("./helpers/mockPrisma");
const { normalizeWeeklyOffDays, workingDaysFromWeeklyOff } = require("../src/utils/policyValidation");

let storedPolicy;
let shiftWrites;
let createdShift;

mockPrisma({
  attendancePolicy: {
    findUnique: async () => storedPolicy,
    upsert: async ({ update, create }) => {
      storedPolicy = { organizationId: "org-1", lateDeductionPercent: 0.25, monthlyPermissionHours: 3, ...(storedPolicy || create), ...update };
      return storedPolicy;
    },
  },
  shift: {
    updateMany: async ({ where, data }) => {
      shiftWrites.push({ where, data });
      return { count: 3 };
    },
    create: async ({ data }) => {
      createdShift = data;
      return { id: "s-new", ...data, _count: { employees: 0 } };
    },
  },
  // The policy save and the shift update happen together, or not at all.
  async $transaction(operations) {
    return Promise.all(operations);
  },
});

const policyService = require("../src/services/policy.service");
const shiftService = require("../src/services/shift.service");

describe("weekly off days", () => {
  it("Sunday off means Monday to Saturday work", () => {
    assert.equal(normalizeWeeklyOffDays("0"), "0");
    assert.equal(workingDaysFromWeeklyOff("0"), "1,2,3,4,5,6");
  });

  it("accepts a list or CSV, sorts it and drops repeats", () => {
    assert.equal(normalizeWeeklyOffDays([6, 0, 0]), "0,6");
    assert.equal(normalizeWeeklyOffDays("6, 0"), "0,6");
    assert.equal(workingDaysFromWeeklyOff("0,6"), "1,2,3,4,5");
  });

  it("allows no weekly off, so every day is a working day", () => {
    assert.equal(normalizeWeeklyOffDays(""), "");
    assert.equal(workingDaysFromWeeklyOff(""), "0,1,2,3,4,5,6");
  });

  it("rejects bad weekdays and more than three off days", () => {
    for (const bad of ["7", "-1", "abc", "1.5", [0, 1, 2, 3]]) {
      assert.throws(() => normalizeWeeklyOffDays(bad), (e) => e.statusCode === 400, JSON.stringify(bad));
    }
  });
});

describe("company weekly off policy", () => {
  beforeEach(() => {
    storedPolicy = undefined;
    shiftWrites = [];
    createdShift = null;
  });

  it("saving it puts the matching working days on every shift of the company", async () => {
    const saved = await policyService.upsertPolicy("org-1", { weeklyOffDays: [0, 6] });
    assert.equal(saved.weeklyOffDays, "0,6");
    assert.equal(saved.shiftsUpdated, 3);
    assert.deepEqual(shiftWrites, [{ where: { organizationId: "org-1" }, data: { workingDays: "1,2,3,4,5" } }]);
  });

  it("leaves the shifts alone when the weekly off is not part of the save", async () => {
    await policyService.upsertPolicy("org-1", { allowWfh: false });
    assert.equal(shiftWrites.length, 0);
  });

  it("rejects an invalid weekly off before touching any shift", async () => {
    await assert.rejects(() => policyService.upsertPolicy("org-1", { weeklyOffDays: "9" }), (e) => e.statusCode === 400);
    assert.equal(shiftWrites.length, 0);
  });

  it("a new shift starts from the company weekly off", async () => {
    storedPolicy = { weeklyOffDays: "0,6" };
    await shiftService.createShift("org-1", { name: "Day", startTime: "09:00", endTime: "18:00" });
    assert.equal(createdShift.workingDays, "1,2,3,4,5");
  });

  it("a company with no setting yet gets Monday to Saturday, Sunday off", async () => {
    storedPolicy = undefined;
    await shiftService.createShift("org-1", { name: "Day", startTime: "09:00", endTime: "18:00" });
    assert.equal(createdShift.workingDays, "1,2,3,4,5,6");
  });

  it("a shift can still be given its own working days", async () => {
    storedPolicy = { weeklyOffDays: "0" };
    await shiftService.createShift("org-1", { name: "Night", startTime: "22:00", endTime: "06:00", workingDays: "1,2,3,4,5" });
    assert.equal(createdShift.workingDays, "1,2,3,4,5");
  });
});
