const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { mockPrisma, installModule } = require("./helpers/mockPrisma");

// Stub only the outbound side effects — NOT notification.service itself,
// which is the module under test (stubSideEffects() would replace it with a
// no-op and silently turn every assertion below into "undefined").
const noop = new Proxy({}, { get: () => async () => ({}) });
installModule(require.resolve("../src/services/email.service"), noop);
installModule(require.resolve("../src/services/whatsapp.service"), noop);

// Mirrors notification.service's own getStartOfToday() + UTC-hour reset
// exactly, so fixtures line up with whatever `today` the service computes —
// this depends on the host's local timezone, which the test must not assume.
const TODAY = (() => {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const today = new Date(startOfToday);
  today.setUTCHours(0, 0, 0, 0);
  return today;
})();
const REST_DAY = [0, 1, 2, 3, 4, 5, 6].filter((d) => d !== TODAY.getDay());

const calls = {};
const track = (name) => {
  calls[name] = (calls[name] || 0) + 1;
};

let db;
const resetDb = () => {
  db = {
    employees: [],
    attendance: [],
    holidays: [],
    leaveRequests: [],
    shifts: [],
    notifications: [],
  };
  for (const key in calls) delete calls[key];
};

const inSet = (value, inArr) => !inArr || inArr.includes(value);

const prisma = {
  employee: {
    findMany: async ({ where }) => {
      track("employee.findMany");
      return db.employees.filter((e) => (where.organizationId ? e.organizationId === where.organizationId : true));
    },
  },
  attendance: {
    findMany: async ({ where }) => {
      track("attendance.findMany");
      return db.attendance.filter((a) => {
        if (!inSet(a.employeeId, where.employeeId?.in)) return false;
        if (where.date && a.date.getTime() !== where.date.getTime()) return false;
        if (where.checkIn?.not === null && a.checkIn == null) return false;
        return true;
      });
    },
    createMany: async ({ data, skipDuplicates }) => {
      track("attendance.createMany");
      let count = 0;
      for (const row of data) {
        const dup = db.attendance.some((a) => a.employeeId === row.employeeId && a.date.getTime() === row.date.getTime());
        if (dup && skipDuplicates) continue;
        db.attendance.push({ ...row });
        count++;
      }
      return { count };
    },
  },
  holiday: {
    findMany: async ({ where }) => {
      track("holiday.findMany");
      return db.holidays.filter((h) => inSet(h.organizationId, where.organizationId?.in) && h.date.getTime() === where.date.getTime() && h.isOptional === where.isOptional);
    },
  },
  leaveRequest: {
    findMany: async ({ where }) => {
      track("leaveRequest.findMany");
      return db.leaveRequests.filter((l) => inSet(l.employeeId, where.employeeId?.in) && l.status === where.status);
    },
  },
  shift: {
    findMany: async ({ where }) => {
      track("shift.findMany");
      return db.shifts.filter((s) => inSet(s.id, where.id?.in));
    },
  },
  notification: {
    findMany: async ({ where }) => {
      track("notification.findMany");
      return db.notifications.filter(
        (n) => inSet(n.userId, where.userId?.in) && n.title.includes(where.title.contains) && n.createdAt >= where.createdAt.gte,
      );
    },
    createMany: async ({ data }) => {
      track("notification.createMany");
      for (const row of data) db.notifications.push({ ...row, createdAt: new Date() });
      return { count: data.length };
    },
  },
};

mockPrisma(prisma);
const notificationService = require("../src/services/notification.service");

const employee = (overrides) => ({
  id: "emp-1",
  userId: "user-1",
  organizationId: "org-1",
  branchId: null,
  shiftId: null,
  firstName: "Employee",
  lastName: "One",
  phone: null,
  user: { email: null },
  shift: null,
  organization: { timezone: "Asia/Kolkata" },
  ...overrides,
});

describe("markAbsentEmployees (batched)", () => {
  beforeEach(resetDb);

  it("resolves present, org holiday, branch holiday, leave, week-off and absent in one pass without N+1 queries", async () => {
    db.employees = [
      employee({ id: "present", organizationId: "org-1" }),
      employee({ id: "org-holiday", organizationId: "org-2" }),
      employee({ id: "branch-holiday", organizationId: "org-1", branchId: "br-1" }),
      employee({ id: "other-branch", organizationId: "org-1", branchId: "br-2" }), // same org holiday row is branch-scoped, so this one is NOT covered
      employee({ id: "on-leave", organizationId: "org-1" }),
      employee({ id: "week-off", organizationId: "org-1", shiftId: "shift-1" }),
      employee({ id: "absent-1", organizationId: "org-1" }),
      employee({ id: "absent-2", organizationId: "org-1", shiftId: "shift-2" }),
    ];
    db.attendance = [{ employeeId: "present", date: TODAY, checkIn: new Date() }];
    db.holidays = [
      { organizationId: "org-2", branchId: null, date: TODAY, isOptional: false }, // org-wide
      { organizationId: "org-1", branchId: "br-1", date: TODAY, isOptional: false }, // branch-only
    ];
    db.leaveRequests = [{ employeeId: "on-leave", status: "APPROVED", startDate: TODAY, endDate: TODAY }];
    db.shifts = [
      // shift-1 works every day except today, so today is a scheduled rest day for it.
      { id: "shift-1", workingDays: REST_DAY.join(",") },
      // shift-2 works today, so having a shift must not by itself excuse an absence.
      { id: "shift-2", workingDays: [0, 1, 2, 3, 4, 5, 6].join(",") },
    ];

    const result = await notificationService.markAbsentEmployees();

    // other-branch, absent-1 and absent-2 — three genuinely absent employees.
    assert.equal(result.markedCount, 3);
    assert.deepEqual(result.markedEmployees, ["Employee One", "Employee One", "Employee One"]); // names are identical by fixture design; count is what matters
    assert.equal(calls["attendance.findMany"], 1, "existing attendance must be fetched in a single batched query");
    assert.equal(calls["holiday.findMany"], 1);
    assert.equal(calls["leaveRequest.findMany"], 1);
    assert.equal(calls["shift.findMany"], 1, "shifts must be fetched in one batched query, not once per employee");

    const byId = Object.fromEntries(db.attendance.map((a) => [a.employeeId, a.status]));
    assert.equal(byId["org-holiday"], undefined); // holiday — never written
    assert.equal(byId["branch-holiday"], undefined);
    assert.equal(byId["other-branch"], "ABSENT"); // different branch, not covered by the branch-scoped holiday
    assert.equal(byId["on-leave"], undefined);
    assert.equal(byId["week-off"], "WEEK_OFF");
    assert.equal(byId["absent-1"], "ABSENT");
    assert.equal(byId["absent-2"], "ABSENT");
  });

  it("does not double-count or duplicate a day that already has a record", async () => {
    db.employees = [employee({ id: "already-present" })];
    db.attendance = [{ employeeId: "already-present", date: TODAY, status: "PRESENT" }];

    const result = await notificationService.markAbsentEmployees();
    assert.equal(result.markedCount, 0);
    assert.equal(db.attendance.length, 1);
  });

  it("returns immediately without any query when there are no active employees", async () => {
    const result = await notificationService.markAbsentEmployees();
    assert.equal(result.markedCount, 0);
    assert.equal(calls["attendance.findMany"], undefined);
  });
});

describe("sendMorningCheckInReminders (batched)", () => {
  beforeEach(resetDb);

  it("notifies employees who have not checked in and have no reminder yet today, skips the rest, in fixed-count queries", async () => {
    db.employees = [
      employee({ id: "not-in-yet", userId: "u-1" }),
      employee({ id: "already-in", userId: "u-2" }),
      employee({ id: "already-notified", userId: "u-3" }),
    ];
    db.attendance = [{ employeeId: "already-in", date: undefined, checkIn: new Date() }];
    // The handler groups by each employee's own local "start of today"; give it directly.
    const { getLocalDateOnly } = require("../src/utils/datetime");
    const startOfToday = getLocalDateOnly(new Date(), "Asia/Kolkata");
    db.attendance[0].date = startOfToday;
    db.notifications = [{ userId: "u-3", title: "Morning Shift Check-In Reminder", createdAt: new Date(startOfToday.getTime() + 1000) }];

    const result = await notificationService.sendMorningCheckInReminders(null, false);

    assert.deepEqual(result.sentUsers, ["Employee (u-1)"]);
    assert.equal(calls["attendance.findMany"], 1);
    assert.equal(calls["notification.findMany"], 1);
    assert.equal(calls["notification.createMany"], 1);
    assert.equal(db.notifications.filter((n) => n.userId === "u-1").length, 1);
  });

  it("skips the database entirely when no employee is inside the reminder window", async () => {
    // Shift starts 12 hours from now in every timezone — never inside the ±1h window.
    const farShift = { name: "Night", startTime: "23:59", workingDays: "0,1,2,3,4,5,6" };
    db.employees = [employee({ id: "far", userId: "u-9", shift: farShift })];

    const result = await notificationService.sendMorningCheckInReminders(null, true);

    assert.equal(result.sentCount, 0);
    assert.equal(calls["attendance.findMany"], undefined);
    assert.equal(calls["notification.findMany"], undefined);
  });
});

describe("sendEveningCheckOutReminders (batched)", () => {
  beforeEach(resetDb);

  it("notifies only employees who checked in but have not checked out, skipping anyone already notified", async () => {
    const { getLocalDateOnly } = require("../src/utils/datetime");
    const startOfToday = getLocalDateOnly(new Date(), "Asia/Kolkata");

    db.employees = [
      employee({ id: "still-working", userId: "u-1" }),
      employee({ id: "already-out", userId: "u-2" }),
      employee({ id: "never-in", userId: "u-3" }),
      employee({ id: "already-notified", userId: "u-4" }),
    ];
    db.attendance = [
      { employeeId: "still-working", date: startOfToday, checkIn: new Date(), checkOut: null },
      { employeeId: "already-out", date: startOfToday, checkIn: new Date(), checkOut: new Date() },
      { employeeId: "already-notified", date: startOfToday, checkIn: new Date(), checkOut: null },
    ];
    db.notifications = [{ userId: "u-4", title: "Shift Completion & Check-Out Reminder", createdAt: new Date(startOfToday.getTime() + 1000) }];

    const result = await notificationService.sendEveningCheckOutReminders(null, false);

    assert.deepEqual(result.sentUsers, ["Employee (u-1)"]);
    assert.equal(calls["attendance.findMany"], 1);
    assert.equal(calls["notification.findMany"], 1);
  });
});
