const { describe, it, beforeEach, afterEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const { mockPrisma } = require("./helpers/mockPrisma");

let leaveRows = [];
let lastLeaveWhere = null;
const payrollEmployee = {
  id: "employee-99",
  employeeCode: "EMP-99",
  firstName: "Salary",
  lastName: "Test",
  department: { name: "Finance" },
};

mockPrisma({
  leaveRequest: {
    findMany: async ({ where }) => {
      lastLeaveWhere = where;
      return leaveRows;
    },
  },
  employee: {
    findFirst: async () => payrollEmployee,
  },
  payslip: {
    findFirst: async () => ({ month: 11, year: 2026, grossSalary: 100000, deductionsTotal: 10000, netSalary: 90000, status: "DISBURSED" }),
  },
  salaryStructure: {
    findUnique: async () => ({ monthlyCtc: 100000, baseSalary: 50000, hra: 25000 }),
  },
});

const { getTodayLeaveSummary, getAuthorizedEmployeePayrollSummary, isClearlyOutOfScope } = require("../src/services/ai.service");

const employee = (id, status = "APPROVED") => ({
  status,
  startDate: new Date("2026-11-22T00:00:00.000Z"),
  endDate: new Date("2026-11-24T00:00:00.000Z"),
  totalDays: 3,
  leaveType: { name: "Casual Leave", code: "CL" },
  employee: {
    id,
    employeeCode: `EMP-${id}`,
    firstName: id,
    lastName: "Test",
    department: { name: "Engineering" },
  },
});

const user = (role, departmentId) => ({
  id: "user-1",
  role,
  organizationId: "org-1",
  organization: { timezone: "Asia/Kolkata", subscriptionPlan: "ENTERPRISE" },
  employee: departmentId ? { departmentId } : null,
});

describe("AI role-based today leave summary", () => {
  beforeEach(() => {
    leaveRows = [];
    lastLeaveWhere = null;
    mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-23T04:00:00.000Z") });
  });

  afterEach(() => mock.timers.reset());

  it("counts unique approved and pending people for HR at organization scope", async () => {
    leaveRows = [employee("A", "APPROVED"), employee("A", "APPROVED"), employee("B", "PENDING")];

    const result = await getTodayLeaveSummary(user("HR"));

    assert.equal(result.date, "2026-11-23");
    assert.equal(result.scope, "organization");
    assert.equal(result.approvedLeaveCount, 1);
    assert.equal(result.pendingLeaveCount, 1);
    assert.equal(lastLeaveWhere.employee.organizationId, "org-1");
    assert.equal(lastLeaveWhere.employee.departmentId, undefined);
  });

  it("limits managers to their department", async () => {
    const result = await getTodayLeaveSummary(user("MANAGER", "dept-7"));

    assert.equal(result.scope, "department");
    assert.equal(lastLeaveWhere.employee.departmentId, "dept-7");
  });

  it("refuses ordinary employees", async () => {
    await assert.rejects(() => getTodayLeaveSummary(user("EMPLOYEE")), (error) => {
      assert.equal(error.statusCode, 403);
      return true;
    });
  });

  it("keeps unrelated requests inside the Clocked HRMS profile", () => {
    assert.equal(isClearlyOutOfScope("Tell me a joke"), true);
    assert.equal(isClearlyOutOfScope("How many people are on leave today?"), false);
    assert.equal(isClearlyOutOfScope("Calculate 2 + 2"), true);
  });

  it("allows HR to retrieve salary by employee code but blocks managers", async () => {
    const result = await getAuthorizedEmployeePayrollSummary(user("HR"), { employeeCode: "EMP-99" });

    assert.equal(result.employee.employeeCode, "EMP-99");
    assert.equal(result.payslip.netSalary, 90000);
    assert.equal(result.salaryStructure.monthlyCtc, 100000);
    await assert.rejects(() => getAuthorizedEmployeePayrollSummary(user("MANAGER", "dept-7"), { employeeCode: "EMP-99" }), (error) => {
      assert.equal(error.statusCode, 403);
      return true;
    });
  });
});
