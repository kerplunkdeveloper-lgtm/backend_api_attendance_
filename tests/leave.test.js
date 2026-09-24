const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { mockPrisma, stubSideEffects } = require("./helpers/mockPrisma");

stubSideEffects();

const employee = {
  id: "emp-1",
  organizationId: "org-1",
  userId: "user-1",
  branchId: null,
  shiftId: "shift-1",
  shift: { id: "shift-1", workingDays: "1,2,3,4,5" },
};

const leaveType = {
  id: "lt-1",
  organizationId: "org-1",
  name: "Casual",
  isPaid: true,
  daysAllowed: 12,
};

const createdRequest = {
  id: "lr-1",
  organizationId: "org-1",
  employeeId: "emp-1",
  leaveTypeId: "lt-1",
  startDate: new Date("2026-09-21T00:00:00.000Z"),
  endDate: new Date("2026-09-21T00:00:00.000Z"),
  totalDays: 1,
  status: "PENDING",
  leaveType,
  employee: { id: "emp-1", firstName: "Ada", lastName: "Lovelace", employeeCode: "E1" },
};

const prisma = {
  organization: {
    findUnique: async () => ({ timezone: "UTC" }),
  },
  employee: {
    findFirst: async () => employee,
  },
  leaveRequest: {
    findFirst: async ({ where }) => {
      if (where?.status?.in) return null;
      if (where?.id === "lr-1") {
        return {
          ...createdRequest,
          employee: { ...employee, userId: "user-1", user: { email: "ada@example.com" } },
        };
      }
      return null;
    },
    create: async () => createdRequest,
    update: async ({ data }) => ({ ...createdRequest, ...data, status: data.status }),
    aggregate: async () => ({ _sum: { totalDays: 0 } }),
  },
  holiday: {
    findMany: async () => [],
  },
  shift: {
    findUnique: async () => employee.shift,
  },
  leaveType: {
    findFirst: async () => leaveType,
  },
  leaveBalance: {
    findUnique: async () => ({ allocatedDays: 12, usedDays: 2 }),
    upsert: async ({ update }) => {
      prisma._usedDays = 2 + (update.usedDays.increment || 0);
      return { usedDays: prisma._usedDays };
    },
  },
  attendance: {
    findUnique: async () => null,
    upsert: async () => ({}),
  },
  async $transaction(fn) {
    return fn(prisma);
  },
};

prisma._usedDays = 2;
mockPrisma(prisma);

const leaveService = require("../src/services/leave.service");

describe("leave", () => {
  it("applies a leave request and approval increments used balance", async () => {
    const applied = await leaveService.createLeaveRequest("user-1", "org-1", {
      leaveTypeId: "lt-1",
      startDate: "2026-09-21",
      endDate: "2026-09-21",
      reason: "Family",
    });
    assert.equal(applied.status, "PENDING");
    assert.equal(applied.totalDays, 1);

    const reviewed = await leaveService.reviewLeaveRequest("lr-1", "org-1", "manager-1", {
      status: "APPROVED",
    });
    assert.equal(reviewed.status, "APPROVED");
    assert.equal(prisma._usedDays, 3);
  });
});
