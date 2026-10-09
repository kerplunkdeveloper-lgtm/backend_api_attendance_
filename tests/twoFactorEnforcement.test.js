const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { requireOwnerTwoFactor } = require("../src/middleware/twoFactor.middleware");

const run = (user) => {
  let status = null;
  let body = null;
  let nexted = false;
  const res = {
    status(code) {
      status = code;
      return this;
    },
    json(payload) {
      body = payload;
      return this;
    },
  };
  requireOwnerTwoFactor({ user }, res, () => {
    nexted = true;
  });
  return { status, body, nexted };
};

describe("owner two-step enforcement", () => {
  beforeEach(() => {
    delete process.env.REQUIRE_OWNER_2FA;
  });

  it("blocks a platform owner who has not turned on two-step verification", () => {
    const r = run({ role: "SUPER_ADMIN", twoFactorEnabled: false });
    assert.equal(r.nexted, false);
    assert.equal(r.status, 403);
    assert.equal(r.body.code, "TWO_FACTOR_REQUIRED");
  });

  it("lets an owner through once it is on", () => {
    assert.equal(run({ role: "SUPER_ADMIN", twoFactorEnabled: true }).nexted, true);
  });

  it("can be switched off for local development only by the explicit flag", () => {
    process.env.REQUIRE_OWNER_2FA = "false";
    assert.equal(run({ role: "SUPER_ADMIN", twoFactorEnabled: false }).nexted, true);
    process.env.REQUIRE_OWNER_2FA = "0";
    assert.equal(run({ role: "SUPER_ADMIN", twoFactorEnabled: false }).nexted, false);
  });

  it("is applied to every owner route group", () => {
    const fs = require("node:fs");
    for (const f of ["platform-admin.routes.js", "billing-admin.routes.js"]) {
      const src = fs.readFileSync(require.resolve(`../src/routes/${f}`), "utf8");
      assert.match(src, /authorizeRoles\("SUPER_ADMIN"\), requireOwnerTwoFactor/);
    }
  });

  it("does not hand a session to anyone who has only passed the password step", () => {
    const fs = require("node:fs");
    const svc = fs.readFileSync(require.resolve("../src/services/auth.service.js"), "utf8").replace(/\r\n/g, "\n");
    // Inside login(): the guard must return before the session token is created.
    const loginAt = svc.indexOf("const login = async");
    const guardAt = svc.indexOf("if (user.twoFactorEnabledAt) {\n    // Password is right", loginAt);
    const issueAt = svc.indexOf("const accessToken = generateAccessToken(tokenPayload);", loginAt);
    assert.ok(loginAt >= 0 && guardAt > loginAt && issueAt > guardAt, "the second-step guard must come before the session is issued");
    assert.match(svc, /uses two-step verification\. Sign in with your email and password/);
  });
});
