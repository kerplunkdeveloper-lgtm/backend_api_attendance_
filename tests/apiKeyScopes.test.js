const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { mockPrisma } = require("./helpers/mockPrisma");

const proOrg = {
  id: "org-a",
  deletedAt: null,
  subscription: { plan: "PROFESSIONAL", status: "ACTIVE", currentPeriodEnd: new Date(Date.now() + 86400000) },
};
const created = [];
mockPrisma({
  organization: { findUnique: async () => proOrg },
  orgApiKey: {
    findMany: async () => [{ id: "k1", organizationId: "org-a", keyHash: "hash", scopes: "read:employees", organization: proOrg }],
    update: async () => ({}),
    create: async ({ data }) => {
      created.push(data);
      return { id: "k1", ...data };
    },
  },
});
const { installModule } = require("./helpers/mockPrisma");
installModule(require.resolve("bcryptjs"), { compare: async () => true, hash: async () => "hash" });

const { requiredScopeFor, authenticate, authorizeRoles } = require("../src/middleware/auth.middleware");
const apikeyService = require("../src/services/apikey.service");

const fakeRes = () => {
  const res = { statusCode: 200, body: null, setHeader: () => {}, on: () => {} };
  res.status = (code) => ((res.statusCode = code), res);
  res.json = (body) => ((res.body = body), res);
  return res;
};

describe("API key scopes", () => {
  it("derives the scope from the router, not substrings of the URL", () => {
    const req = (method, baseUrl, originalUrl) => ({ method, baseUrl, originalUrl });
    assert.equal(requiredScopeFor(req("GET", "/api/reports", "/api/reports/attendance-summary")), "read:reports");
    assert.equal(requiredScopeFor(req("POST", "/api/attendance/corrections", "/api/attendance/corrections")), "write:attendance");
    assert.equal(requiredScopeFor(req("GET", "/employees", "/employees/123")), "read:employees");
    assert.equal(requiredScopeFor(req("GET", "/api/v1/payroll", "/api/v1/payroll/runs")), "read:payroll");
    assert.equal(requiredScopeFor(req("DELETE", "/api/organization", "/api/organization/employees")), "write:admin");
  });

  it("enforces scope in authenticate, so authenticate-only routes are covered", async () => {
    const req = {
      method: "GET",
      baseUrl: "/api/notifications",
      originalUrl: "/api/notifications",
      headers: { "x-api-key": "wp_live_abcdef1234567890" },
    };
    const res = fakeRes();
    let passed = false;
    await authenticate(req, res, () => (passed = true));
    assert.equal(passed, false);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.requiredScope, "read:admin");
  });

  it("lets a key through when it holds the scope, and skips role checks after", async () => {
    const req = {
      method: "GET",
      baseUrl: "/api/employees",
      originalUrl: "/api/employees",
      headers: { "x-api-key": "wp_live_abcdef1234567890" },
    };
    const res = fakeRes();
    let passed = false;
    await authenticate(req, res, () => (passed = true));
    assert.equal(passed, true);
    assert.equal(req.user.organizationId, "org-a");
    let roleCheckPassed = false;
    authorizeRoles("COMPANY_ADMIN")(req, res, () => (roleCheckPassed = true));
    assert.equal(roleCheckPassed, true);
  });

  it("refuses to issue keys with unknown scopes", async () => {
    await assert.rejects(() => apikeyService.createKey("org-a", "Bad", ["read:everything"]), (e) => e.statusCode === 400);
    assert.equal(created.length, 0);
    const key = await apikeyService.createKey("org-a", "Good", ["read:leave"]);
    assert.deepEqual(key.scopes, ["read:leave"]);
  });
});

describe("entitlements fail closed", () => {
  it("blocks the app for an unrecognized subscription status", () => {
    const { evaluateEntitlement } = require("../src/services/entitlement.service");
    const result = evaluateEntitlement({ id: "org-x", subscription: { status: "MYSTERY" } });
    assert.equal(result.allowApp, false);
    assert.equal(result.code, "SUBSCRIPTION_UNKNOWN");
  });
});
