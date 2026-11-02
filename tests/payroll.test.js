const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { mockPrisma } = require("./helpers/mockPrisma");

let ownPayslipQuery;
const db = mockPrisma({
  payslip: {
    count: async () => 2,
    findMany: async (args) => {
      ownPayslipQuery = args;
      return [];
    },
    findFirst: async () => null,
  },
  employee: {
    findFirst: async () => ({ id: "emp-1" }),
  },
});

const payrollService = require("../src/services/payroll.service");

describe("payroll", () => {
  it("blocks regenerate when the month is already APPROVED", async () => {
    await assert.rejects(
      () => payrollService.generateOrganizationPayslips("org-1", 9, 2026),
      /already approved or disbursed/
    );
  });

  it("only exposes disbursed payslips to employees", async () => {
    await payrollService.getMyPayslips("user-1", "org-1");
    assert.equal(ownPayslipQuery.where.status, "DISBURSED");
  });

  it("blocks an employee from opening an unapproved payslip", async () => {
    let detailsQuery;
    db.payslip.findFirst = async (args) => {
      detailsQuery = args;
      return null;
    };

    await assert.rejects(
      () => payrollService.getPayslipDetails("org-1", "payslip-1", "emp-1"),
      /Payslip not found/,
    );
    assert.equal(detailsQuery.where.status, "DISBURSED");
  });
});
