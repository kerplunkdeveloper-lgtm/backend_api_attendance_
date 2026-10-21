const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

process.env.TENANT_RATE_LIMIT_PER_MIN = "3";
process.env.API_KEY_RATE_LIMIT_PER_MIN = "2";
delete process.env.REDIS_URL;

const { tenantRateLimiter } = require("../src/middleware/rateLimiter.middleware");

const fakeRes = () => {
  const res = { statusCode: 200, headers: {} };
  res.setHeader = (k, v) => (res.headers[k] = v);
  res.status = (code) => ((res.statusCode = code), res);
  res.json = (body) => ((res.body = body), res);
  res.on = () => {};
  return res;
};
const hit = (user, extra = {}) => {
  const res = fakeRes();
  let passed = false;
  tenantRateLimiter({ user, ...extra }, res, () => (passed = true));
  return passed ? 200 : res.statusCode;
};

describe("per-workspace rate limit", () => {
  it("caps one workspace without affecting another", () => {
    const a = { id: "u1", role: "EMPLOYEE", organizationId: "org-rl-a" };
    const b = { id: "u2", role: "EMPLOYEE", organizationId: "org-rl-b" };
    assert.deepEqual([hit(a), hit(a), hit(a), hit(a)], [200, 200, 200, 429]);
    assert.equal(hit(b), 200, "a different workspace has its own budget");
  });

  it("gives each API key a tighter budget inside its workspace", () => {
    const keyUser = { id: "apikey:k1", role: "API_KEY", organizationId: "org-rl-c" };
    const asKey = () => hit(keyUser, { authType: "api_key", apiKey: { id: "k1" } });
    assert.deepEqual([asKey(), asKey(), asKey()], [200, 200, 429]);
  });

  it("never limits the platform owner", () => {
    const owner = { id: "o1", role: "SUPER_ADMIN", organizationId: "org-rl-d" };
    for (let i = 0; i < 10; i += 1) assert.equal(hit(owner), 200);
  });
});
