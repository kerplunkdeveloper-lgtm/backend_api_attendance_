const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { mockPrisma } = require("./helpers/mockPrisma");

const employees = [
  { id: "emp-first", organizationId: "org-a", userId: "u-first", user: { role: "EMPLOYEE" } },
  { id: "emp-mgr", organizationId: "org-a", userId: "u-mgr", user: { role: "MANAGER" } },
  { id: "emp-worker", organizationId: "org-a", userId: "u-worker", user: { role: "EMPLOYEE" } },
];
let loans;
let created;

mockPrisma({
  employee: {
    findFirst: async ({ where }) =>
      employees.find(
        (e) =>
          e.organizationId === where.organizationId &&
          (where.id === undefined || e.id === where.id) &&
          (where.userId === undefined || e.userId === where.userId),
      ) || null,
  },
  loanAdvance: {
    create: async ({ data }) => {
      created = data;
      return { id: "new", ...data };
    },
    findFirst: async ({ where }) => {
      const loan = loans.find((l) => l.id === where.id && l.organizationId === where.organizationId);
      if (!loan) return null;
      const owner = employees.find((e) => e.id === loan.employeeId);
      return { ...loan, employee: { user: { role: owner.user.role } } };
    },
    update: async ({ where, data }) => {
      const loan = loans.find((l) => l.id === where.id);
      Object.assign(loan, Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)));
      return loan;
    },
  },
});

const loanService = require("../src/services/loan.service");

beforeEach(() => {
  created = null;
  loans = [
    { id: "L-worker", organizationId: "org-a", employeeId: "emp-worker", amount: 6000, monthlyRecovery: 0, outstanding: 6000, status: "PENDING" },
    { id: "L-mgr", organizationId: "org-a", employeeId: "emp-mgr", amount: 3000, monthlyRecovery: 500, outstanding: 3000, status: "PENDING" },
  ];
});

describe("applying for a loan", () => {
  it("files for the signed-in manager, not the first employee in the organization", async () => {
    await loanService.apply("org-a", { id: "u-mgr", role: "MANAGER" }, { amount: 1000, monthlyRecovery: 200 });
    assert.equal(created.employeeId, "emp-mgr");
  });

  it("lets an admin file on behalf of a named employee", async () => {
    await loanService.apply("org-a", { id: "u-mgr", role: "COMPANY_ADMIN" }, { employeeId: "emp-worker", amount: 1000 });
    assert.equal(created.employeeId, "emp-worker");
  });

  it("ignores an employeeId sent by an ordinary employee", async () => {
    await loanService.apply("org-a", { id: "u-worker", role: "EMPLOYEE" }, { employeeId: "emp-first", amount: 1000 });
    assert.equal(created.employeeId, "emp-worker");
  });
});

describe("reviewing a loan", () => {
  it("refuses to approve a loan that has no monthly recovery, which would never be repaid", async () => {
    await assert.rejects(
      loanService.review("org-a", "L-worker", { status: "APPROVED" }, "u-mgr", "MANAGER"),
      (err) => err.statusCode === 400 && /monthly recovery/i.test(err.message),
    );
    assert.equal(loans[0].status, "PENDING");
  });

  it("approves once a recovery amount is supplied", async () => {
    await loanService.review("org-a", "L-worker", { status: "APPROVED", monthlyRecovery: 1000 }, "u-mgr", "MANAGER");
    assert.equal(loans[0].status, "APPROVED");
    assert.equal(loans[0].monthlyRecovery, 1000);
  });

  it("requires an admin for a loan raised by a manager", async () => {
    await assert.rejects(
      loanService.review("org-a", "L-mgr", { status: "APPROVED" }, "u-other-mgr", "MANAGER"),
      (err) => err.statusCode === 403,
    );
    await loanService.review("org-a", "L-mgr", { status: "APPROVED" }, "u-admin", "COMPANY_ADMIN");
    assert.equal(loans[1].status, "APPROVED");
  });
});
