/**
 * Runs the real Prisma client (with the tenant guard extension) against a
 * disposable Postgres that already has the schema applied. Skipped unless
 * TEST_DATABASE_URL is set, because it writes rows:
 *
 *   TEST_DATABASE_URL=postgresql://ci:ci@127.0.0.1:5432/ci npm run test:integration
 */
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");

const url = process.env.TEST_DATABASE_URL;

describe("tenant guard against a real database", { skip: !url && "TEST_DATABASE_URL not set" }, () => {
  let prisma;
  let tenant;
  const suffix = Date.now().toString(36);
  const ids = {};

  before(async () => {
    // RUNTIME_DATABASE_URL wins over DATABASE_URL, so pin both to the test DB.
    process.env.DATABASE_URL = url;
    process.env.RUNTIME_DATABASE_URL = url;
    prisma = require("../../src/config/database");
    tenant = require("../../src/utils/tenantContext");
    for (const key of ["a", "b"]) {
      const org = await prisma.organization.create({ data: { name: `Guard ${key} ${suffix}` } });
      const emp = await prisma.employee.create({
        data: { organizationId: org.id, employeeCode: `G${key}-${suffix}`, firstName: `Emp ${key}` },
      });
      ids[key] = { org: org.id, emp: emp.id };
    }
  });

  after(async () => {
    if (!prisma) return;
    const orgIds = Object.values(ids).map((v) => v.org);
    await prisma.employee.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
    await prisma.$disconnect();
  });

  const asTenant = (org, fn) =>
    tenant.runWithRequestStore(() => {
      tenant.setTenant(org);
      return fn();
    });

  it("hides another tenant's rows from lists, counts and unique lookups", async () => {
    await asTenant(ids.a.org, async () => {
      const rows = await prisma.employee.findMany({ where: { employeeCode: { startsWith: "G" } } });
      assert.ok(rows.every((r) => r.organizationId === ids.a.org));
      assert.ok(rows.some((r) => r.id === ids.a.emp));
      assert.equal(await prisma.employee.findUnique({ where: { id: ids.b.emp } }), null);
      assert.equal(await prisma.employee.findFirst({ where: { id: ids.b.emp } }), null);
      assert.equal(await prisma.employee.count({ where: { id: ids.b.emp } }), 0);
    });
  });

  it("cannot update or delete another tenant's rows", async () => {
    await asTenant(ids.a.org, async () => {
      await assert.rejects(() => prisma.employee.update({ where: { id: ids.b.emp }, data: { firstName: "Hacked" } }));
      const { count } = await prisma.employee.deleteMany({ where: { id: ids.b.emp } });
      assert.equal(count, 0);
    });
    const untouched = await prisma.employee.findUnique({ where: { id: ids.b.emp } });
    assert.equal(untouched.firstName, "Emp b");
  });

  it("stays scoped inside interactive transactions", async () => {
    await asTenant(ids.a.org, () =>
      prisma.$transaction(async (tx) => {
        assert.equal(await tx.employee.findUnique({ where: { id: ids.b.emp } }), null);
        assert.ok(await tx.employee.findUnique({ where: { id: ids.a.emp } }));
      }),
    );
  });

  it("rejects creating a row in another tenant", async () => {
    await asTenant(ids.a.org, async () => {
      await assert.rejects(
        () => prisma.employee.create({ data: { organizationId: ids.b.org, employeeCode: `X-${suffix}`, firstName: "X" } }),
        (e) => e.code === "TENANT_SCOPE_VIOLATION",
      );
    });
  });

  it("runs unscoped outside a request", async () => {
    assert.ok(await prisma.employee.findUnique({ where: { id: ids.b.emp } }));
  });
});
