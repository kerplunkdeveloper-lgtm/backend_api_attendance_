const { describe, it, beforeEach, afterEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const { mockPrisma, stubSideEffects } = require("./helpers/mockPrisma");

stubSideEffects();

const employee = { id: "emp-1", userId: "u-emp", organizationId: "org-1", branchId: null, shiftId: "s-1", firstName: "Asha", lastName: "R", user: { role: "EMPLOYEE" } };
const sunday = new Date("2026-10-25T00:00:00.000Z");

let requests;
let notifications;
let holidayToday;
let weeklyOff;
let requesterRole;
let reviewers;

const shift = () => ({ id: "s-1", name: "General", startTime: "09:00", endTime: "18:00", graceMinutes: 10, workingDays: weeklyOff ? "1,2,3,4,5" : "0,1,2,3,4,5,6" });

mockPrisma({
  organization: { findUnique: async () => ({ timezone: "UTC", name: "Acme" }) },
  employee: { findFirst: async () => ({ ...employee, user: { role: requesterRole }, shift: shift() }) },
  shiftOverride: { findUnique: async () => null },
  shift: { findFirst: async () => shift(), findUnique: async () => shift() },
  holiday: { findFirst: async () => holidayToday },
  companyLeave: { findFirst: async () => null },
  user: { findMany: async ({ where }) => reviewers.filter((u) => where.role.in.includes(u.role) && u.id !== where.id.not) },
  notification: {
    createMany: async ({ data }) => {
      notifications.push(...data);
      return { count: data.length };
    },
  },
  dayOffWorkRequest: {
    findFirst: async ({ where, include }) => {
      const row = requests.find((r) => (!where.id || r.id === where.id) && (!where.employeeId || r.employeeId === where.employeeId) && (!where.organizationId || r.organizationId === where.organizationId));
      if (!row) return null;
      // The real query returns the requester with the row when asked to.
      return include?.employee ? { ...row, employee: { id: employee.id, userId: employee.userId, firstName: employee.firstName, user: { role: requesterRole } } } : row;
    },
    create: async ({ data }) => {
      const row = { id: `req-${requests.length + 1}`, createdAt: new Date(), ...data };
      requests.push(row);
      return row;
    },
    update: async ({ where, data }) => {
      const row = requests.find((r) => r.id === where.id);
      Object.assign(row, data);
      return row;
    },
    findMany: async () => requests,
    count: async () => requests.length,
    groupBy: async () => [{ status: "PENDING", _count: { _all: requests.filter((r) => r.status === "PENDING").length } }],
  },
});

const service = require("../src/services/dayoff-work.service");

describe("working on a day off", () => {
  beforeEach(() => {
    // A Sunday: the weekly off.
    mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-25T08:00:00.000Z") });
    requests = [];
    notifications = [];
    holidayToday = null;
    weeklyOff = true;
    requesterRole = "EMPLOYEE";
    reviewers = [
      { id: "u-admin", role: "COMPANY_ADMIN" },
      { id: "u-hr", role: "MANAGER" },
    ];
  });
  afterEach(() => mock.timers.reset());

  it("refuses a request on an ordinary working day", async () => {
    weeklyOff = false;
    await assert.rejects(() => service.createRequest("u-emp", "org-1", { reasonType: "SHOOT" }), (e) => e.statusCode === 400 && /normal working day/.test(e.message));
  });

  it("needs a known reason, and a description for 'other'", async () => {
    await assert.rejects(() => service.createRequest("u-emp", "org-1", { reasonType: "PARTY" }), (e) => e.statusCode === 400);
    await assert.rejects(() => service.createRequest("u-emp", "org-1", { reasonType: "OTHER", note: " " }), /what the work is/);
  });

  it("records a pending request for the day, telling HR and the admin (not the employee)", async () => {
    const request = await service.createRequest("u-emp", "org-1", { reasonType: "SHOOT", note: "Product shoot at the studio" });
    assert.equal(request.status, "PENDING");
    assert.equal(request.dayKind, "WEEK_OFF");
    assert.equal(request.reasonType, "SHOOT");
    assert.equal(request.date.toISOString(), sunday.toISOString());
    assert.deepEqual(notifications.map((n) => n.userId).sort(), ["u-admin", "u-hr"]);
    assert.match(notifications[0].message, /Asha R wants to work on .*Sunday.*weekly off.*Shoot/);
  });

  it("names a holiday as the reason the day is closed", async () => {
    weeklyOff = false;
    holidayToday = { name: "Diwali" };
    const request = await service.createRequest("u-emp", "org-1", { reasonType: "TRAVEL" });
    assert.equal(request.dayKind, "HOLIDAY");
  });

  it("does not take a second request while one is waiting or approved", async () => {
    await service.createRequest("u-emp", "org-1", { reasonType: "SHOOT" });
    await assert.rejects(() => service.createRequest("u-emp", "org-1", { reasonType: "SHOOT" }), (e) => e.statusCode === 409 && /waiting/.test(e.message));
    requests[0].status = "APPROVED";
    await assert.rejects(() => service.createRequest("u-emp", "org-1", { reasonType: "SHOOT" }), (e) => e.statusCode === 409 && /already approved/.test(e.message));
  });

  it("lets someone ask again after a rejection, reopening the same request", async () => {
    await service.createRequest("u-emp", "org-1", { reasonType: "SHOOT" });
    requests[0].status = "REJECTED";
    requests[0].reviewNote = "Not needed";
    const again = await service.createRequest("u-emp", "org-1", { reasonType: "CLIENT_VISIT", note: "Client moved the date" });
    assert.equal(requests.length, 1);
    assert.equal(again.status, "PENDING");
    assert.equal(again.reviewNote, null);
    assert.equal(again.reasonType, "CLIENT_VISIT");
  });

  it("HR or an admin can approve an employee's request, and the employee is told", async () => {
    await service.createRequest("u-emp", "org-1", { reasonType: "SHOOT" });
    notifications.length = 0;
    for (const role of ["MANAGER", "COMPANY_ADMIN"]) {
      requests[0].status = "PENDING";
      const done = await service.reviewRequest("req-1", "org-1", "u-reviewer", { status: "APPROVED" }, role);
      assert.equal(done.status, "APPROVED");
    }
    assert.equal(notifications.at(-1).userId, "u-emp");
    assert.match(notifications.at(-1).message, /You can punch in/);
  });

  it("an employee's rejection note reaches them", async () => {
    await service.createRequest("u-emp", "org-1", { reasonType: "SHOOT" });
    notifications.length = 0;
    await service.reviewRequest("req-1", "org-1", "u-hr", { status: "REJECTED", reviewNote: "Shoot moved to Monday" }, "MANAGER");
    assert.match(notifications[0].message, /not approved.*Shoot moved to Monday/);
  });

  it("HR cannot approve a request raised by HR or an admin: only an admin can", async () => {
    requesterRole = "MANAGER";
    await service.createRequest("u-emp", "org-1", { reasonType: "TRAVEL" });
    await assert.rejects(() => service.reviewRequest("req-1", "org-1", "u-other-hr", { status: "APPROVED" }, "MANAGER"), (e) => e.statusCode === 403);
    const done = await service.reviewRequest("req-1", "org-1", "u-admin", { status: "APPROVED" }, "COMPANY_ADMIN");
    assert.equal(done.status, "APPROVED");
  });

  it("nobody approves their own request", async () => {
    await service.createRequest("u-emp", "org-1", { reasonType: "SHOOT" });
    await assert.rejects(() => service.reviewRequest("req-1", "org-1", "u-emp", { status: "APPROVED" }, "COMPANY_ADMIN"), (e) => e.statusCode === 403 && /own request/.test(e.message));
  });

  it("a request can be decided once", async () => {
    await service.createRequest("u-emp", "org-1", { reasonType: "SHOOT" });
    await service.reviewRequest("req-1", "org-1", "u-hr", { status: "APPROVED" }, "MANAGER");
    await assert.rejects(() => service.reviewRequest("req-1", "org-1", "u-admin", { status: "REJECTED" }, "COMPANY_ADMIN"), (e) => e.statusCode === 409);
  });

  it("only APPROVED or REJECTED are decisions", async () => {
    await assert.rejects(() => service.reviewRequest("req-1", "org-1", "u-hr", { status: "MAYBE" }, "MANAGER"), (e) => e.statusCode === 400);
  });
});
