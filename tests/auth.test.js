const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const bcrypt = require("bcryptjs");
const { mockPrisma } = require("./helpers/mockPrisma");

const prisma = mockPrisma({
  user: {
    findMany: async () => [],
    findUnique: async () => null,
    update: async () => ({}),
  },
  refreshToken: {
    create: async () => ({}),
    findUnique: async () => null,
  },
});

const authService = require("../src/services/auth.service");
const authController = require("../src/controllers/auth.controller");
const { authenticate } = require("../src/middleware/auth.middleware");
const { schemas } = require("../src/middleware/validate.middleware");
const { protectCookieMutation } = require("../src/middleware/requestSecurity.middleware");

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

  it("allows employees to sign in through the web attendance portal", async () => {
    const password = "Password123";
    prisma.user.findMany = async () => [{
      id: "employee-web-user",
      email: "employee@example.com",
      passwordHash: await bcrypt.hash(password, 4),
      role: "EMPLOYEE",
      organizationId: "org-employee",
      isActive: true,
      organization: {
        id: "org-employee",
        deletedAt: null,
        subscriptionStatus: "TRIALING",
        trialEndsAt: new Date(Date.now() + 86400000),
        subscriptionPlan: "FREE_TRIAL",
      },
      employee: {
        id: "employee-1",
        firstName: "Web",
        lastName: "Employee",
        deletedAt: null,
        branch: null,
        shift: null,
        department: null,
      },
    }];
    prisma.refreshToken.create = async ({ data }) => data;

    const result = await authService.login("employee@example.com", password, "web");

    assert.equal(result.user.role, "EMPLOYEE");
    assert.ok(result.accessToken);
  });

  it("uses only an access JWT during login", async () => {
    const password = "Password123";
    let refreshTokenWrites = 0;
    prisma.user.findMany = async () => [{
      id: "u-hash",
      email: "admin@example.com",
      passwordHash: await bcrypt.hash(password, 4),
      role: "COMPANY_ADMIN",
      organizationId: "org-hash",
      isActive: true,
      organization: {
        id: "org-hash",
        deletedAt: null,
        subscriptionStatus: "TRIALING",
        trialEndsAt: new Date(Date.now() + 86400000),
        subscriptionPlan: "FREE_TRIAL",
      },
      employee: null,
    }];
    prisma.refreshToken.create = async () => {
      refreshTokenWrites += 1;
      return {};
    };

    const result = await authService.login("admin@example.com", password, "web");

    assert.ok(result.accessToken);
    assert.equal(result.token, result.accessToken);
    assert.equal(result.refreshToken, undefined);
    assert.equal(refreshTokenWrites, 0);
  });

  it("keeps browser refresh tokens out of JSON responses", async () => {
    const originalLogin = authService.login;
    authService.login = async () => ({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      user: { id: "u1" },
    });
    let payload;
    const req = {
      body: { email: "admin@example.com", password: "Password123", client: "web" },
      headers: {},
    };
    const res = {
      cookie() {},
      json(value) { payload = value; return this; },
      status() { return this; },
    };

    try {
      await authController.login(req, res);
      assert.equal(payload.data.accessToken, "access-token");
      assert.equal(Object.hasOwn(payload.data, "refreshToken"), false);
    } finally {
      authService.login = originalLogin;
    }
  });

  it("rejects cross-origin refresh-cookie mutations without relying on a client marker", () => {
    const previousFrontendUrl = process.env.FRONTEND_URL;
    process.env.FRONTEND_URL = "https://app.workpulse.example";
    const req = {
      body: {},
      cookies: { refreshToken: "browser-cookie" },
      headers: { origin: "https://attacker.example" },
      requestId: "request-123",
    };
    let statusCode;
    let payload;
    const res = {
      status(code) { statusCode = code; return this; },
      json(value) { payload = value; return this; },
    };

    try {
      protectCookieMutation(req, res, () => {
        throw new Error("next should not be called");
      });
      assert.equal(statusCode, 403);
      assert.equal(payload.message, "Untrusted browser origin.");
    } finally {
      if (previousFrontendUrl === undefined) delete process.env.FRONTEND_URL;
      else process.env.FRONTEND_URL = previousFrontendUrl;
    }
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
