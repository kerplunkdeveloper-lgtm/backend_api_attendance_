const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { mockPrisma } = require("./helpers/mockPrisma");

const loans = [
  {
    id: "loan-1",
    organizationId: "org-a",
    employeeId: "emp-1",
    monthlyRecovery: 1000,
    outstanding: 5000,
    status: "APPROVED",
  },
];

const repayments = [];

mockPrisma({
  loanAdvance: {
    findMany: async () => loans.filter((l) => l.status === "APPROVED" && l.outstanding > 0),
    update: async ({ where, data }) => {
      const loan = loans.find((l) => l.id === where.id);
      Object.assign(loan, data);
      if (data.outstanding !== undefined) loan.outstanding = data.outstanding;
      return loan;
    },
  },
  loanRepayment: {
    findFirst: async ({ where }) =>
      repayments.find(
        (r) => r.loanId === where.loanId && r.year === where.year && r.month === where.month,
      ) || null,
    create: async ({ data }) => {
      repayments.push(data);
      return data;
    },
  },
});

const loanService = require("../src/services/loan.service");

describe("loan payroll recovery", () => {
  it("previews recovery without writing, then posts once when committed", async () => {
    const preview = await loanService.recoverForPayroll({
      organizationId: "org-a",
      employeeId: "emp-1",
      month: 9,
      year: 2026,
      commit: false,
    });
    assert.equal(preview.total, 1000);
    assert.equal(loans[0].outstanding, 5000);
    assert.equal(repayments.length, 0);

    const posted = await loanService.recoverForPayroll({
      organizationId: "org-a",
      employeeId: "emp-1",
      month: 9,
      year: 2026,
      commit: true,
    });
    assert.equal(posted.total, 1000);
    assert.equal(loans[0].outstanding, 4000);
    assert.equal(repayments.length, 1);

    const replay = await loanService.recoverForPayroll({
      organizationId: "org-a",
      employeeId: "emp-1",
      month: 9,
      year: 2026,
      commit: true,
    });
    assert.equal(replay.total, 1000);
    assert.equal(loans[0].outstanding, 4000);
    assert.equal(repayments.length, 1);
  });
});
