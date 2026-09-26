const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { mockPrisma } = require("./helpers/mockPrisma");

const captured = [];

mockPrisma({
  overtimeRequest: {
    findMany: async ({ where }) => {
      captured.push(where);
      return [];
    },
    count: async () => 0,
  },
});

const overtimeController = require("../src/controllers/overtime.controller");

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

describe("pending query construction", () => {
  it("does not rely on mutating a getter-backed query object", () => {
    const reqQuery = {};
    Object.defineProperty(reqQuery, "status", {
      configurable: true,
      enumerable: true,
      get() {
        return undefined;
      },
      set() {
        // Express 5 query objects ignore assignment through the getter.
      },
    });

    reqQuery.status = "PENDING";
    assert.equal(reqQuery.status, undefined);

    const forwarded = { ...{ organizationId: "org-a" }, status: "PENDING" };
    assert.equal(forwarded.status, "PENDING");
    assert.equal(forwarded.organizationId, "org-a");
  });

  it("pending overtime controller enforces PENDING even when req.query cannot be mutated", async () => {
    captured.length = 0;
    const query = {};
    Object.defineProperty(query, "status", {
      configurable: true,
      enumerable: true,
      get() {
        return undefined;
      },
      set() {},
    });

    const req = {
      user: { organizationId: "org-a" },
      pendingOnly: true,
      query,
    };
    const res = mockRes();
    await overtimeController.getAllRequests(req, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(captured[0], { organizationId: "org-a", status: "PENDING" });
  });
});
