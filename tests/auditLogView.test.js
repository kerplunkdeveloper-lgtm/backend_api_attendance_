const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { mockPrisma } = require("./helpers/mockPrisma");

let lastWhere;
mockPrisma({
  auditLog: {
    findMany: async ({ where }) => {
      lastWhere = where;
      return [
        { id: "1", userId: "u1", action: "CREATE", entity: "EMPLOYEE", createdAt: new Date() },
        { id: "2", userId: "gone", action: "DELETE", entity: "BRANCH", createdAt: new Date() },
      ];
    },
    count: async () => 2,
  },
  user: {
    findMany: async ({ where }) => {
      assert.equal(where.organizationId, "org-1");
      return [{ id: "u1", email: "hr@acme.test", role: "MANAGER", employee: { firstName: "Priya", lastName: "N" } }];
    },
  },
});

const auditService = require("../src/services/audit.service");

describe("audit log view", () => {
  it("names the person behind each entry and tolerates deleted users", async () => {
    const result = await auditService.getAuditLogs("org-1", {});
    assert.equal(result.logs[0].actor.name, "Priya N");
    assert.equal(result.logs[0].actor.role, "MANAGER");
    assert.equal(result.logs[1].actor, null);
  });

  it("always scopes to the organization and keeps platform entries out", async () => {
    await auditService.getAuditLogs("org-1", { entity: "PLATFORM" });
    assert.equal(lastWhere.organizationId, "org-1");
    assert.deepEqual(lastWhere.entity, { not: "PLATFORM" });
  });

  it("filters by date range, including the whole last day, and ignores bad dates", async () => {
    await auditService.getAuditLogs("org-1", { from: "2026-10-01", to: "2026-10-02" });
    assert.equal(lastWhere.createdAt.gte.toISOString().slice(0, 10), "2026-10-01");
    assert.equal(lastWhere.createdAt.lt.toISOString().slice(0, 10), "2026-10-03");
    await auditService.getAuditLogs("org-1", { from: "nonsense" });
    assert.equal(lastWhere.createdAt, undefined);
  });
});
