const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { sendControllerError } = require("../src/utils/controllerError");

const response = () => ({
  req: { requestId: "req-test" },
  statusCode: null,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

describe("controller error responses", () => {
  it("does not expose unexpected database errors as client validation failures", () => {
    const res = response();
    sendControllerError(res, Object.assign(new Error("SQL details"), { code: "P2025" }));
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.message, "Internal Server Error");
    assert.equal(res.body.requestId, "req-test");
  });

  it("preserves deliberate client errors", () => {
    const res = response();
    sendControllerError(res, Object.assign(new Error("Invalid plan"), { statusCode: 400, code: "BAD_PLAN" }));
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.message, "Invalid plan");
    assert.equal(res.body.code, "BAD_PLAN");
  });
});
