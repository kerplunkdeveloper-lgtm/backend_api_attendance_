const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { mockPrisma } = require("./helpers/mockPrisma");

mockPrisma({
  payslip: {
    count: async () => 2,
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
});
