const { describe, it, beforeEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const { mockPrisma } = require("./helpers/mockPrisma");

let employeeWhere;
let lastEmployeeQuery;
const employee = {
  id: "employee-1", employeeCode: "KM005", firstName: "Kavi", lastName: "M",
  status: "ACTIVE", designation: "Designer", dateOfJoining: new Date("2025-01-02"),
  employmentType: "FULL_TIME", workEmail: "kavi@example.com", department: { name: "Design" },
  branch: { name: "Chennai" }, shift: { name: "Day", startTime: "09:00", endTime: "18:00", graceMinutes: 10 },
  reportingManager: { employeeCode: "M001", firstName: "Team", lastName: "Lead" },
};

mockPrisma({
  employee: {
    findFirst: async ({ where }) => { lastEmployeeQuery = where; return employeeWhere ? employee : null; },
  },
  employeeDocument: { count: async () => 2 },
  salaryStructure: { findFirst: async () => ({ monthlyCtc: 100000, annualCtc: 1200000, baseSalary: 50000, hra: 25000, transport: 5000, special: 10000, otherAllowance: 10000, pf: 1800, esi: 0, professionalTax: 200 }) },
  payslip: { findFirst: async () => ({ month: 11, year: 2026, grossSalary: 100000, deductionsTotal: 10000, netSalary: 90000, status: "DISBURSED" }) },
  attendance: { findMany: async () => [] },
  leaveRequest: { findMany: async () => [] },
  overtimeRequest: { findMany: async () => [] },
  companyPolicy: { findMany: async () => [] },
  employee: { findFirst: async ({ where }) => { lastEmployeeQuery = where; return employeeWhere ? employee : null; }, groupBy: async () => [], count: async () => 1 },
  department: { count: async () => 1 },
  branch: { count: async () => 1 },
});

const tools = require("../src/services/ai-agent-tools.service");
const user = (role, extra = {}) => ({ id: "user-1", role, organizationId: "org-1", employee: { id: "employee-1", employeeCode: "KM005", departmentId: "dept-1" }, ...extra });

describe("role-based AI data tools", () => {
  beforeEach(() => { employeeWhere = true; lastEmployeeQuery = null; });

  it("resolves employee codes only inside the tenant and manager department", async () => {
    const result = await tools.searchAuthorizedEmployee(user("MANAGER"), { employeeCode: "KM005" });
    assert.equal(result.employee.employeeCode, "KM005");
    assert.equal(lastEmployeeQuery.organizationId, "org-1");
    assert.equal(lastEmployeeQuery.departmentId, "dept-1");
    assert.equal(lastEmployeeQuery.employeeCode, "KM005");
  });

  it("allows an employee to read only their own profile", async () => {
    const result = await tools.getEmployeeProfile(user("EMPLOYEE"), { employeeCode: "KM005" });
    assert.equal(result.employee.employeeCode, "KM005");
    await assert.rejects(() => tools.getEmployeeProfile(user("EMPLOYEE"), { employeeCode: "OTHER" }), /permission/);
  });

  it("blocks salary tools for employees and managers", async () => {
    await assert.rejects(() => tools.getEmployeePayrollBreakdown(user("EMPLOYEE"), { employeeCode: "KM005", year: 2026, month: 11 }), (error) => error.statusCode === 403);
    await assert.rejects(() => tools.getEmployeeSalaryStructure(user("MANAGER"), { employeeCode: "KM005" }), (error) => error.statusCode === 403);
  });

  it("requires an explicit valid payroll period when supplied", async () => {
    await assert.rejects(() => tools.getEmployeePayrollBreakdown(user("HR"), { employeeCode: "KM005", year: 2026, month: 13 }), /Invalid payroll period/);
    const result = await tools.getEmployeePayrollBreakdown(user("HR"), { employeeCode: "KM005", year: 2026, month: 11 });
    assert.equal(result.payrollPeriod.month, 11);
    assert.equal(result.payslip.netSalary, 90000);
  });
});
