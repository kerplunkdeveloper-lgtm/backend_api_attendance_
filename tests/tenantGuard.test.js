const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { scopeArgs, tenantGuardExtension, TENANT_MODELS } = require("../src/config/tenantGuard");
const { runWithRequestStore, setTenant, runUnscoped, getTenantId } = require("../src/utils/tenantContext");

const blocked = (e) => e.code === "TENANT_SCOPE_VIOLATION" && e.statusCode === 404;
const run = (operation, args, model = "Employee") =>
  tenantGuardExtension.query.$allModels.$allOperations({
    model,
    operation,
    args,
    query: async (scoped) => scoped,
  });

describe("tenant guard", () => {
  it("leaves queries alone when no tenant is in scope", () => {
    const args = { where: { id: "e1" } };
    assert.equal(scopeArgs("Employee", "findMany", args, null), args);
  });

  it("leaves non-tenant models alone", () => {
    const args = { where: { id: "org-b" } };
    assert.equal(scopeArgs("Organization", "findUnique", args, "org-a"), args);
    assert.equal(scopeArgs("RefreshToken", "deleteMany", args, "org-a"), args);
  });

  it("narrows list, count and bulk writes to the caller's organization", () => {
    for (const op of ["findMany", "findFirst", "count", "aggregate", "groupBy", "updateMany", "deleteMany"]) {
      const scoped = scopeArgs("Employee", op, { where: { status: "ACTIVE" } }, "org-a");
      assert.deepEqual(scoped.where, { AND: [{ status: "ACTIVE" }, { organizationId: "org-a" }] }, op);
    }
    assert.deepEqual(scopeArgs("Employee", "findMany", {}, "org-a").where, { organizationId: "org-a" });
    assert.deepEqual(scopeArgs("Employee", "findMany", undefined, "org-a").where, { organizationId: "org-a" });
  });

  it("adds the organization to single-record lookups and writes", () => {
    for (const op of ["findUnique", "findUniqueOrThrow", "update", "delete"]) {
      const scoped = scopeArgs("Employee", op, { where: { id: "e1" }, data: { firstName: "A" } }, "org-a");
      assert.deepEqual(scoped.where, { id: "e1", organizationId: "org-a" }, op);
    }
  });

  it("blocks a query that names another organization", () => {
    assert.throws(() => scopeArgs("Employee", "findMany", { where: { organizationId: "org-b" } }, "org-a"), blocked);
    assert.throws(() => scopeArgs("Employee", "findUnique", { where: { id: "e1", organizationId: "org-b" } }, "org-a"), blocked);
    assert.throws(
      () => scopeArgs("User", "findUnique", { where: { organizationId_email: { organizationId: "org-b", email: "x@y.z" } } }, "org-a"),
      blocked,
    );
  });

  it("blocks creating or moving rows into another organization", () => {
    assert.throws(() => scopeArgs("Employee", "create", { data: { organizationId: "org-b" } }, "org-a"), blocked);
    assert.throws(() => scopeArgs("Employee", "create", { data: { organization: { connect: { id: "org-b" } } } }, "org-a"), blocked);
    assert.throws(() => scopeArgs("Employee", "createMany", { data: [{ organizationId: "org-a" }, { organizationId: "org-b" }] }, "org-a"), blocked);
    assert.throws(() => scopeArgs("Employee", "update", { where: { id: "e1" }, data: { organizationId: "org-b" } }, "org-a"), blocked);
    assert.throws(() => scopeArgs("Employee", "updateMany", { where: {}, data: { organizationId: "org-b" } }, "org-a"), blocked);
    assert.throws(
      () => scopeArgs("Employee", "upsert", { where: { id: "e1" }, create: { organizationId: "org-b" }, update: {} }, "org-a"),
      blocked,
    );
  });

  it("allows creates in the caller's own organization unchanged", () => {
    const args = { data: { organizationId: "org-a", firstName: "A" } };
    assert.deepEqual(scopeArgs("Employee", "create", args, "org-a"), args);
  });

  it("covers every model that carries a tenant column", () => {
    for (const model of ["Employee", "Attendance", "Payslip", "LeaveRequest", "User", "OrgApiKey", "WebhookEndpoint", "ChatMessage"]) {
      assert.ok(TENANT_MODELS.has(model), model);
    }
    assert.ok(!TENANT_MODELS.has("Organization"));
    assert.ok(!TENANT_MODELS.has("BillingEvent"), "BillingEvent has a nullable organization");
  });

  it("reads the tenant from the request store and isolates concurrent requests", async () => {
    const results = await Promise.all(
      ["org-a", "org-b"].map((org) =>
        runWithRequestStore(async () => {
          setTenant(org);
          await new Promise((r) => setTimeout(r, 5));
          return run("findMany", { where: {} });
        }),
      ),
    );
    assert.deepEqual(results.map((r) => r.where.AND[1].organizationId), ["org-a", "org-b"]);
  });

  it("runs unscoped outside a request and inside runUnscoped", async () => {
    assert.equal(getTenantId(), null);
    assert.deepEqual(await run("findMany", { where: {} }), { where: {} });
    await runWithRequestStore(async () => {
      setTenant("org-a");
      const inner = await runUnscoped(() => run("findMany", { where: {} }));
      assert.deepEqual(inner, { where: {} });
      assert.equal(getTenantId(), "org-a", "the outer request stays scoped");
    });
  });

  it("can be switched off with TENANT_GUARD=off as an emergency switch", async () => {
    process.env.TENANT_GUARD = "off";
    try {
      await runWithRequestStore(async () => {
        setTenant("org-a");
        assert.deepEqual(await run("findMany", { where: {} }), { where: {} });
      });
    } finally {
      delete process.env.TENANT_GUARD;
    }
  });
});
