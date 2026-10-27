const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { safeValue } = require("../src/utils/logger");

describe("structured logger redaction", () => {
  it("redacts credential fields and secret-like text", () => {
    const safe = safeValue({ authorization: "Bearer secret-token", nested: { password: "pw" }, message: "resetToken=hidden" });
    assert.equal(safe.authorization, "[REDACTED]");
    assert.equal(safe.nested.password, "[REDACTED]");
    assert.match(safe.message, /resetToken=\[REDACTED\]/);
  });
});