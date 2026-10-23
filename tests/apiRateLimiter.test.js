const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { apiRateLimiter } = require("../src/middleware/rateLimiter.middleware");

const res = () => ({
  statusCode: 200,
  headers: {},
  setHeader(k, v) { this.headers[k] = v; },
  status(c) { this.statusCode = c; return this; },
  json() { return this; },
});
const hit = (headers, ip) => {
  const r = res();
  let passed = false;
  apiRateLimiter({ ip, headers, socket: {} }, r, () => { passed = true; });
  return { passed, r };
};

describe("general API limiter", () => {
  it("lets signed-in users sharing one proxy IP use far more than 200 requests a minute", () => {
    for (let i = 0; i < 1000; i++) assert.ok(hit({ authorization: "Bearer abc.def.ghi" }, "198.51.100.1").passed, `request ${i}`);
  });

  it("keeps anonymous traffic on the strict budget", () => {
    let blocked = 0;
    for (let i = 0; i < 250; i++) if (!hit({}, "198.51.100.2").passed) blocked++;
    assert.equal(blocked, 50);
  });

  it("does not let anonymous floods use up the signed-in bucket on the same IP", () => {
    for (let i = 0; i < 300; i++) hit({}, "198.51.100.3");
    assert.ok(hit({ authorization: "Bearer abc.def.ghi" }, "198.51.100.3").passed);
  });
});
