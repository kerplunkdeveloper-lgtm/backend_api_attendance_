const test = require("node:test");
const assert = require("node:assert/strict");
const { mockPrisma } = require("./helpers/mockPrisma");

const now = new Date();
const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
let request;
let updateData;

mockPrisma({
  organization: {
    findUnique: async () => ({ timezone: "UTC" }),
  },
  employee: {
    findFirst: async () => ({ id: "emp-1", userId: "user-1", branchId: "branch-1", user: { role: "EMPLOYEE" } }),
  },
  branch: {
    findMany: async () => [{ id: "branch-1", name: "HQ", latitude: 11.94, longitude: 79.80, radiusMeters: 200 }],
  },
  permissionRequest: {
    findFirst: async ({ where }) => {
      if (where.id === "permission-1") return request;
      return null;
    },
    update: async ({ data }) => {
      updateData = data;
      request = { ...request, ...data };
      return request;
    },
  },
});

const permissionService = require("../src/services/permission.service");

test("permission start rejects a location outside the office geofence", async () => {
  request = { id: "permission-1", organizationId: "org-1", employeeId: "emp-1", date: today, status: "APPROVED", startedAt: null, endedAt: null };
  await assert.rejects(
    () => permissionService.startSession("org-1", "user-1", "permission-1", { latitude: 12.1, longitude: 79.8 }),
    (error) => error.statusCode === 403 && error.code === "OUTSIDE_OFFICE",
  );
});

test("permission start and end capture time and office location", async () => {
  request = { id: "permission-1", organizationId: "org-1", employeeId: "emp-1", date: today, status: "APPROVED", startedAt: null, endedAt: null };
  await permissionService.startSession("org-1", "user-1", "permission-1", { latitude: 11.9401, longitude: 79.8001, locationLabel: "HQ" });
  assert.ok(updateData.startedAt);
  assert.equal(updateData.startLocation, "HQ");

  // Keep the test deterministic without waiting for the wall clock to tick.
  request.startedAt = new Date(Date.now() - 60_000);
  await permissionService.endSession("org-1", "user-1", "permission-1", { latitude: 11.9401, longitude: 79.8001, locationLabel: "HQ" });
  assert.ok(updateData.endedAt);
  assert.equal(updateData.endLocation, "HQ");
});
