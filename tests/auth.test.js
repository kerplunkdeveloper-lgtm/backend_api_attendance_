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
const { schemas } = require("../src/middleware/validate.middleware");

describe("auth", () => {
  it("rejects invalid login credentials", async () => {
    await assert.rejects(
      () => authService.login("nobody@example.com", "wrong-password"),
      /Invalid email or password/
    );
  });

  it("accepts an employee code in the email login field", () => {
    const result = schemas.login.safeParse({
      email: "WP-EMP-003",
      password: "Password@123",
    });

    assert.equal(result.success, true);
  });

  it("looks up an employee code submitted in the email login field", async () => {
    let query;
    prisma.user.findMany = async (input) => {
      query = input;
      return [];
    };

    await assert.rejects(
      () => authService.login("WP-EMP-003", "wrong-password"),
      /Invalid email or password/
    );
    assert.deepEqual(query.where.employee.employeeCode, {
      equals: "WP-EMP-003",
      mode: "insensitive",
    });
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

  it("returns 402 when an expired canceled organization presents a valid JWT", async () => {
    const { generateAccessToken } = require("../src/utils/jwt");
    prisma.user.findUnique = async () => ({
      id: "u1",
      isActive: true,
      role: "COMPANY_ADMIN",
      organizationId: "org-a",
      email: "admin@example.com",
      organization: {
        subscriptionStatus: "CANCELED",
        subscriptionExpiresAt: new Date("2020-01-01T00:00:00.000Z"),
        deletedAt: null,
      },
      employee: null,
    });

    const token = generateAccessToken({ userId: "u1", organizationId: "org-a" });
    const req = {
      headers: { authorization: `Bearer ${token}` },
      originalUrl: "/api/employees",
      path: "/api/employees",
    };
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

    assert.equal(statusCode, 402);
    assert.equal(body.code, "SUBSCRIPTION_CANCELED");
  });
});
