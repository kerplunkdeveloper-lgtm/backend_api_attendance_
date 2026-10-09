const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { validate, schemas } = require("../src/middleware/validate.middleware");

function run(schema, body) {
  const req = { body };
  let statusCode = 200;
  let payload;
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(value) {
      payload = value;
      return this;
    },
  };
  let called = false;
  validate(schema)(req, res, () => {
    called = true;
  });
  return { req, statusCode, payload, called };
}

describe("request validation", () => {
  it("rejects impossible GPS coordinates", () => {
    const result = run(schemas.checkIn, { latitude: 120, longitude: 80 });

    assert.equal(result.called, false);
    assert.equal(result.statusCode, 400);
    assert.equal(result.payload.success, false);
  });

  it("accepts a complete ISO timestamp and normalizes numeric fields", () => {
    const result = run(schemas.checkIn, {
      latitude: "12.9716",
      longitude: "77.5946",
      accuracy: "15",
      timestamp: "2026-09-29T03:30:00.000Z",
    });

    assert.equal(result.called, true);
    assert.equal(result.req.body.latitude, 12.9716);
    assert.equal(result.req.body.accuracy, 15);
  });

  it("accepts the very coarse accuracy laptops report from IP/Wi-Fi location", () => {
    const result = run(schemas.checkIn, { latitude: 19.07, longitude: 72.87, accuracy: 148213.6 });

    assert.equal(result.called, true);
    assert.equal(result.req.body.accuracy, 148213.6);
  });

  it("replaces Zod's developer-facing messages with plain language", () => {
    const coords = run(schemas.checkIn, { latitude: 120, longitude: 80 });
    assert.doesNotMatch(coords.payload.message, /Too big|expected/);
    assert.match(coords.payload.message, /couldn't read your location/);

    const note = run(schemas.checkIn, { note: "x".repeat(501) });
    assert.equal(note.payload.message, "The note is too long.");
  });

  it("keeps messages a schema defines itself", () => {
    const result = run(schemas.resetPassword, { token: "x".repeat(20), newPassword: "short" });
    assert.equal(result.payload.message, "Password must be at least 8 characters");
  });
});
