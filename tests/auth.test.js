const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { mockPrisma } = require("./helpers/mockPrisma");

const prisma = mockPrisma({
  user: {
    findMany: async () => [],
    findUnique: async () => null,
  },
  refreshToken: {
    create: async () => ({}),
    findUnique: async () => null,
  },
});

const authService = require("../src/services/auth.service");
const { authenticate } = require("../src/middleware/auth.middleware");

describe("auth", () => {
  it("rejects invalid login credentials", async () => {
    await assert.rejects(
      () => authService.login("nobody@example.com", "wrong-password"),
      /Invalid email or password/
    );
  });

  it("rejects unauthorized requests without a bearer token", async () => {
    const req = { headers: {} };
    let statusCode = 0;
    let body = null;
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(payload) {
        body = payload;
        return this;
      },
    };

    await authenticate(req, res, () => {
      throw new Error("next should not be called");
    });

    assert.equal(statusCode, 401);
    assert.equal(body.success, false);
    assert.match(body.message, /Authorization token required/);
  });
});
