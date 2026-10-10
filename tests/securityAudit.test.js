const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { mockPrisma, stubSideEffects } = require("./helpers/mockPrisma");

stubSideEffects();

// Employees known to the mock: one in org-a, one in org-b.
const employees = [
  { id: "emp-a", organizationId: "org-a", deletedAt: null },
  { id: "emp-b", organizationId: "org-b", deletedAt: null },
];
const writes = [];
mockPrisma({
  employee: {
    findFirst: async ({ where }) => employees.find((e) => e.id === where.id && e.organizationId === where.organizationId) || null,
  },
  itDeclaration: {
    upsert: async (args) => {
      writes.push(args);
      return { id: "decl" };
    },
  },
});

const statutory = require("../src/services/statutory.service");
const read = (p) => fs.readFileSync(require.resolve(p), "utf8").replace(/\r\n/g, "\n");

describe("security audit regressions", () => {
  it("refuses to write another organization's tax declaration", async () => {
    await assert.rejects(() => statutory.upsertDeclaration("org-a", "emp-b", { regime: "NEW" }), (e) => e.statusCode === 404);
    assert.equal(writes.length, 0, "nothing may be written for a foreign employee");
  });

  it("refuses to read (or create) another organization's tax declaration", async () => {
    const before = writes.length;
    await assert.rejects(() => statutory.getOrCreateDeclaration("org-a", "emp-b"), (e) => e.statusCode === 404);
    assert.equal(writes.length, before);
  });

  it("still saves a declaration for an employee of the same organization", async () => {
    await statutory.upsertDeclaration("org-a", "emp-a", { regime: "OLD" });
    assert.equal(writes.at(-1).create.organizationId, "org-a");
    assert.equal(writes.at(-1).create.employeeId, "emp-a");
  });

  it("validates the reporting manager on employee create and update", () => {
    const src = read("../src/services/employee.service.js");
    assert.equal((src.match(/Reporting manager must be a colleague in the same organization/g) || []).length, 2);
  });

  it("never returns password-reset links unless explicitly enabled outside production", () => {
    const src = read("../src/services/auth.service.js");
    assert.match(src, /process\.env\.NODE_ENV !== "production" && process\.env\.EXPOSE_RESET_LINKS === "true"/);
    assert.doesNotMatch(src, /lastEmailResult\?\.simulated\n\s*\?/);
  });

  it("does not load password hashes or two-step secrets unless a query opts in", () => {
    const db = read("../src/config/database.js");
    assert.match(db, /omit: \{\n\s*user: \{ passwordHash: true, twoFactorSecret: true, twoFactorBackupCodes: true, twoFactorLastStep: true, emailVerificationCodeHash: true \}/);
  });

  it("limits org-wide expense totals to admins and HR", () => {
    const routes = read("../src/routes/expense.routes.js");
    assert.match(routes, /router\.get\("\/summary", authorizeRoles\("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"\)/);
  });

  it("rate-limits plan unlock attempts", () => {
    const routes = read("../src/routes/auth.routes.js");
    assert.match(routes, /"\/activate-plan",\n\s*authenticate,\n\s*authRateLimiter,/);
  });
});
