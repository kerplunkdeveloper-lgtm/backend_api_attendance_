const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { mockPrisma } = require("./helpers/mockPrisma");

const updates = [];
mockPrisma({
  organization: {
    update: async (args) => {
      updates.push(args.data);
      return { id: "org-a", ...args.data };
    },
    findUnique: async () => ({ id: "org-a" }),
  },
});

const { denyIfTenantTwoFactorMissing } = require("../src/middleware/twoFactor.middleware");
const orgService = require("../src/services/org.service");
const { presentAuthUser } = require("../src/services/entitlement.service");

const fakeRes = () => {
  const res = { statusCode: 200, body: null };
  res.status = (code) => ((res.statusCode = code), res);
  res.json = (body) => ((res.body = body), res);
  return res;
};
const admin = (overrides = {}) => ({
  role: "COMPANY_ADMIN",
  twoFactorEnabled: false,
  organization: { requireAdminTwoFactor: true },
  ...overrides,
});

describe("workspace two-step policy", () => {
  it("blocks a company admin without 2FA when the workspace requires it", () => {
    const res = fakeRes();
    const sent = denyIfTenantTwoFactorMissing({ user: admin(), originalUrl: "/api/employees" }, res);
    assert.ok(sent);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.code, "TWO_FACTOR_REQUIRED");
  });

  it("still lets that admin reach session and 2FA setup endpoints", () => {
    for (const url of ["/api/auth/me", "/api/auth/2fa/setup", "/api/auth/2fa/confirm", "/auth/logout", "/api/auth/refresh"]) {
      assert.equal(denyIfTenantTwoFactorMissing({ user: admin(), originalUrl: url }, fakeRes()), null, url);
    }
    const res = fakeRes();
    assert.ok(denyIfTenantTwoFactorMissing({ user: admin(), originalUrl: "/api/auth/2factor-bypass" }, res));
  });

  it("does nothing when 2FA is on, the policy is off, or the user is not an admin", () => {
    const url = "/api/employees";
    assert.equal(denyIfTenantTwoFactorMissing({ user: admin({ twoFactorEnabled: true }), originalUrl: url }, fakeRes()), null);
    assert.equal(denyIfTenantTwoFactorMissing({ user: admin({ organization: { requireAdminTwoFactor: false } }), originalUrl: url }, fakeRes()), null);
    assert.equal(denyIfTenantTwoFactorMissing({ user: admin({ role: "EMPLOYEE" }), originalUrl: url }, fakeRes()), null);
  });

  it("refuses to switch the policy on for an admin who would lock themselves out", async () => {
    await assert.rejects(
      () => orgService.updateSettings("org-a", { requireAdminTwoFactor: true }, { role: "COMPANY_ADMIN", twoFactorEnabled: false }),
      (e) => e.statusCode === 400,
    );
    assert.equal(updates.length, 0);
    await orgService.updateSettings("org-a", { requireAdminTwoFactor: true }, { role: "COMPANY_ADMIN", twoFactorEnabled: true });
    assert.equal(updates.at(-1).requireAdminTwoFactor, true);
    await orgService.updateSettings("org-a", { requireAdminTwoFactor: false }, { role: "COMPANY_ADMIN", twoFactorEnabled: false });
    assert.equal(updates.at(-1).requireAdminTwoFactor, false);
  });

  it("tells the client when setup is required, and never sends the unlock code hash", () => {
    const me = presentAuthUser({
      id: "u1",
      role: "COMPANY_ADMIN",
      twoFactorEnabledAt: null,
      organization: { id: "org-a", requireAdminTwoFactor: true, subscription: { status: "ACTIVE" } },
    });
    assert.equal(me.twoFactorEnabled, false);
    assert.equal(me.twoFactorSetupRequired, true);
    const { organizationWithSubscription } = require("../src/utils/prismaSelects");
    assert.equal(organizationWithSubscription.select.unlockCode, undefined);
  });
});
