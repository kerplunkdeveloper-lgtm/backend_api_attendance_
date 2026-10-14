const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { signature } = require("../src/services/webhook.service");

describe("outbound webhooks", () => {
  it("produces a verifiable HMAC signature over timestamp and body", () => {
    const secret = "whsec_test";
    const timestamp = 1700000000;
    const body = JSON.stringify({ event: "webhook.test" });
    const expected = crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
    assert.equal(signature(secret, timestamp, body), expected);
  });

  it("is mounted behind company-admin API access controls", () => {
    const source = fs.readFileSync(require.resolve("../src/routes/webhook.routes.js"), "utf8");
    assert.match(source, /authorizeRoles\("COMPANY_ADMIN"\)/);
    assert.match(source, /requireFeature\("hasApiAccess", "API access"\)/);
  });
});
