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
  dateOfJoining: new Date("2020-01-01T00:00:00.000Z"),
  shift: { id: "shift-1", workingDays: "1,2,3,4,5" },
};

let defaultTypes = [];
let balanceUpserts = 0;

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
          status: prisma._leaveStatus || createdRequest.status,
          employee: { ...employee, userId: "user-1", user: { email: "ada@example.com" } },
        };
      }
      return null;
    },
    create: async () => createdRequest,
    update: async ({ data }) => ({ ...createdRequest, ...data, status: data.status }),
    updateMany: async ({ data }) => {
      prisma._leaveStatus = data.status;
      return { count: 1 };
    },
    aggregate: async () => ({ _sum: { totalDays: 0 } }),
  },
  attendancePolicy: {
    findUnique: async () => null,
  },
  holiday: {
    findMany: async () => [],
  },
  shift: {
    findUnique: async () => employee.shift,
  },
  leaveType: {
    findFirst: async () => leaveType,
    findMany: async () => defaultTypes,
    upsert: async ({ create }) => {
      const existing = defaultTypes.find((item) => item.code === create.code);
      if (existing) return existing;
      const item = { ...create, id: `lt-${defaultTypes.length + 1}` };
      defaultTypes.push(item);
      return item;
    },
  },
  leaveBalance: {
    findUnique: async () => ({ allocatedDays: 12, usedDays: 2 }),
    upsert: async ({ update, create }) => {
      if (update?.usedDays?.increment !== undefined) {
        prisma._usedDays = 2 + update.usedDays.increment;
        return { usedDays: prisma._usedDays };
      }
      balanceUpserts += 1;
      return { id: `bal-${balanceUpserts}`, year: create.year, allocatedDays: create.allocatedDays, usedDays: 0 };
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
  it("initializes leave types and balances safely when the page loads", async () => {
    defaultTypes = [];
    balanceUpserts = 0;
    const [typesA, typesB] = await Promise.all([
      leaveService.getLeaveTypes("org-1"),
      leaveService.getLeaveTypes("org-1"),
    ]);
    assert.equal(typesA.length, 4);
    assert.equal(typesB.length, 4);
    assert.equal(new Set(defaultTypes.map((item) => item.code)).size, 4);

    prisma.leaveBalance.findUnique = async () => null;
    const balances = await leaveService.getLeaveBalances("user-1", "org-1", 2026);
    assert.equal(balances.length, 4);
    assert.equal(balanceUpserts, 4);
  });

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
