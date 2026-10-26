const { describe, it, beforeEach, afterEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const { mockPrisma, stubSideEffects } = require("./helpers/mockPrisma");

stubSideEffects();

const employee = { id: "emp-1", organizationId: "org-1", userId: "user-1", branchId: null, shiftId: "s-1", shift: null, branch: null };
const shift = { id: "s-1", name: "General", startTime: "09:00", endTime: "18:00", graceMinutes: 10, workingDays: "1,2,3,4,5,6" };

// What the day looks like for the employee. Tests change these.
let leave;
let holiday;
let companyLeave;
let existing;
let saved;
let workingDays;
let compOffCredit;
let approval;

mockPrisma({
  organization: { findUnique: async () => ({ timezone: "UTC", name: "Acme" }) },
  attendancePolicy: { findUnique: async () => ({ requireTrustedDevice: false, allowWfh: true, geofenceStrict: false, checkInLocationMode: "ANYWHERE" }) },
  employee: { findFirst: async () => employee },
  shiftOverride: { findUnique: async () => null, findFirst: async () => null },
  shift: { findFirst: async () => ({ ...shift, workingDays }), findUnique: async () => ({ ...shift, workingDays }) },
  branch: { findMany: async () => [] },
  holiday: { findFirst: async () => holiday },
  dayOffWorkRequest: { findFirst: async () => approval },
  leaveRequest: { findFirst: async () => leave },
  companyLeave: { findFirst: async () => companyLeave },
  attendance: {
    findUnique: async () => existing,
    findFirst: async () => existing,
    upsert: async ({ create }) => {
      saved = { id: "att-1", ...create };
      return saved;
    },
    update: async ({ data }) => {
      saved = { ...existing, ...data };
      return saved;
    },
  },
  compOffBalance: { upsert: async ({ create }) => ({ id: "bal-1", ...create }), update: async () => ({}) },
  compOffTransaction: {
    findFirst: async () => null,
    create: async ({ data }) => {
      compOffCredit = data;
      return data;
    },
  },
  overtimeRequest: { findFirst: async () => null, create: async ({ data }) => data },
  attendanceEvent: { create: async ({ data }) => ({ id: "ev-1", ...data }), findFirst: async () => null, findMany: async () => [] },
  async $transaction(fn) {
    return fn(this);
  },
});

const { checkIn, checkOut } = require("../src/services/attendance.service");

// A Monday at 09:50 (60 minutes after a 09:00 shift start, so it would normally be LATE).
const MONDAY_LATE = "2026-10-26T09:50:00.000Z";
const punch = () => checkIn({ latitude: 11.9416, longitude: 79.8083, userId: "user-1", organizationId: "org-1", workMode: "WORK_FROM_HOME", timestamp: MONDAY_LATE, actorRole: "COMPANY_ADMIN" });

describe("punching in on a day off", () => {
  beforeEach(() => {
    // Freeze the clock a few seconds after the punch time: a punch cannot be dated in the future.
    mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-26T09:50:05.000Z") });
    leave = null;
    holiday = null;
    companyLeave = null;
    existing = null;
    saved = null;
    approval = null;
    workingDays = "1,2,3,4,5,6";
  });
  afterEach(() => mock.timers.reset());

  it("an ordinary working day is checked for lateness", async () => {
    const res = await checkIn({ latitude: 11.9416, longitude: 79.8083, userId: "user-1", organizationId: "org-1", workMode: "OFFICE", timestamp: MONDAY_LATE, actorRole: "COMPANY_ADMIN", skipGeofence: true });
    assert.equal(res.attendance.status, "LATE");
    assert.ok(res.attendance.lateMinutes > 0);
    assert.match(res.message, /late/i);
  });

  it("works on an approved leave day, with no late mark and an overtime message", async () => {
    leave = { id: "l-1", status: "APPROVED" };
    const res = await punch();
    assert.equal(res.success, true);
    assert.equal(res.attendance.lateMinutes, 0);
    assert.match(res.message, /Approved Leave Day/);
    assert.match(res.message, /Overtime/);
  });

  it("is closed on a company holiday until HR or an admin approves work, and says why", async () => {
    holiday = { name: "Diwali" };
    await assert.rejects(
      () => punch(),
      (e) => e.statusCode === 403 && e.code === "DAY_OFF_APPROVAL_REQUIRED" && /company holiday \(Diwali\)/.test(e.message) && /approve/i.test(e.message),
    );
    assert.equal(saved, null, "nothing may be recorded for a blocked punch");
  });

  it("opens on that holiday once the work is approved, as overtime with no late mark", async () => {
    holiday = { name: "Diwali" };
    approval = { id: "req-1", reasonType: "SHOOT" };
    const res = await punch();
    assert.equal(res.attendance.lateMinutes, 0);
    assert.match(res.message, /Holiday \(Diwali\)/);
  });

  it("is closed on company leave, naming it, until approved", async () => {
    companyLeave = { title: "Year-end shutdown", isPaid: true };
    await assert.rejects(() => punch(), (e) => e.statusCode === 403 && /company leave \(Year-end shutdown\)/.test(e.message));
    approval = { id: "req-1" };
    const res = await punch();
    assert.match(res.message, /Holiday \(Year-end shutdown\)/);
  });

  it("is closed on the weekly off, naming the weekday, until approved", async () => {
    workingDays = "2,3,4,5,6"; // Monday is not a working day
    await assert.rejects(() => punch(), (e) => e.statusCode === 403 && /Today is Monday, your weekly off/.test(e.message));
    approval = { id: "req-1" };
    const res = await punch();
    assert.match(res.message, /Weekend \/ Rest Day/);
  });

  it("an admin recording a punch for someone is not blocked", async () => {
    holiday = { name: "Diwali" };
    const res = await checkIn({ latitude: 11.9416, longitude: 79.8083, userId: "admin-1", employeeId: "emp-1", organizationId: "org-1", workMode: "WORK_FROM_HOME", timestamp: MONDAY_LATE, actorRole: "COMPANY_ADMIN" });
    assert.equal(res.success, true);
  });

  it("personal approved leave is not closed: that person may still choose to work", async () => {
    leave = { id: "l-1", status: "APPROVED" };
    const res = await punch();
    assert.equal(res.success, true);
  });

  it("still refuses a second punch-in on the same leave day", async () => {
    leave = { id: "l-1", status: "APPROVED" };
    existing = { id: "att-1", checkIn: new Date("2026-10-26T04:00:00Z"), events: [] };
    await assert.rejects(() => punch(), /Already punched in/);
  });
});

describe("punching out on a day off", () => {
  beforeEach(() => {
    // 8 hours after the punch-in below.
    mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-26T17:00:05.000Z") });
    leave = { id: "l-1", status: "APPROVED" };
    holiday = null;
    companyLeave = null;
    compOffCredit = null;
    workingDays = "1,2,3,4,5,6";
    existing = {
      id: "att-1",
      employeeId: "emp-1",
      organizationId: "org-1",
      date: new Date("2026-10-26T00:00:00.000Z"),
      checkIn: new Date("2026-10-26T09:00:00.000Z"),
      checkOut: null,
      status: "PRESENT",
      breakMinutes: 0,
      lunchMinutes: 0,
      lateMinutes: 0,
      shift: { ...shift, workingDays },
      branch: null,
      events: [],
    };
  });
  afterEach(() => mock.timers.reset());

  it("closes the shift on an approved leave day and logs all of it as overtime", async () => {
    const res = await checkOut({ latitude: 11.9416, longitude: 79.8083, userId: "user-1", organizationId: "org-1", timestamp: "2026-10-26T17:00:00.000Z", actorRole: "COMPANY_ADMIN" });
    assert.equal(res.success, true);
    assert.equal(res.attendance.workingMinutes, 480);
    assert.equal(res.attendance.overtimeMinutes, 480);
    assert.match(res.message, /Overtime/);
  });

  it("credits one comp-off day for a full day worked on leave", async () => {
    await checkOut({ latitude: 11.9416, longitude: 79.8083, userId: "user-1", organizationId: "org-1", timestamp: "2026-10-26T17:00:00.000Z", actorRole: "COMPANY_ADMIN" });
    assert.equal(compOffCredit.type, "CREDIT");
    assert.equal(compOffCredit.days, 1);
  });
});

describe("a punch needs GPS", () => {
  beforeEach(() => {
    mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-26T09:50:05.000Z") });
    leave = null; holiday = null; companyLeave = null; existing = null; saved = null; approval = null; workingDays = "1,2,3,4,5,6";
  });
  afterEach(() => mock.timers.reset());

  const noGps = { userId: "user-1", organizationId: "org-1", timestamp: MONDAY_LATE, actorRole: "EMPLOYEE" };

  it("refuses a punch-in without a position, in every work mode", async () => {
    for (const workMode of ["OFFICE", "WORK_FROM_HOME", "CLIENT_VISIT", "TRAVEL", "SHOOT"]) {
      await assert.rejects(
        () => checkIn({ ...noGps, workMode }),
        (e) => e.statusCode === 403 && e.code === "LOCATION_REQUIRED" && /Turn on location \(GPS\) to punch in/.test(e.message),
        workMode,
      );
    }
    assert.equal(saved, null, "nothing may be recorded without a position");
  });

  it("refuses a punch-out without a position", async () => {
    existing = { id: "att-1", employeeId: "emp-1", organizationId: "org-1", date: new Date("2026-10-26T00:00:00.000Z"), checkIn: new Date("2026-10-26T09:00:00.000Z"), checkOut: null, status: "PRESENT", breakMinutes: 0, lunchMinutes: 0, lateMinutes: 0, shift: { ...shift, workingDays }, branch: null, events: [] };
    await assert.rejects(() => checkOut(noGps), (e) => e.code === "LOCATION_REQUIRED" && /punch out/.test(e.message));
  });

  it("treats a blank or non-numeric position as missing", async () => {
    for (const bad of [{ latitude: "", longitude: "" }, { latitude: "abc", longitude: "x" }, { latitude: null, longitude: 79.8 }]) {
      await assert.rejects(() => checkIn({ ...noGps, ...bad, workMode: "WORK_FROM_HOME" }), (e) => e.code === "LOCATION_REQUIRED", JSON.stringify(bad));
    }
  });

  it("accepts a position of exactly 0,0 as a position", async () => {
    const res = await checkIn({ ...noGps, latitude: 0, longitude: 0, workMode: "WORK_FROM_HOME" });
    assert.equal(res.success, true);
  });

  it("an admin or HR punching in for themselves needs GPS too", async () => {
    await assert.rejects(() => checkIn({ ...noGps, actorRole: "COMPANY_ADMIN", employeeId: "emp-1", workMode: "WORK_FROM_HOME" }), (e) => e.code === "LOCATION_REQUIRED");
  });

  it("an admin recording a punch for another employee does not need a phone position", async () => {
    const res = await checkIn({ ...noGps, userId: "admin-1", actorRole: "COMPANY_ADMIN", employeeId: "emp-1", workMode: "WORK_FROM_HOME" });
    assert.equal(res.success, true);
  });

  it("an admin punching in for themselves on a holiday still needs approval", async () => {
    holiday = { name: "Diwali" };
    await assert.rejects(
      () => checkIn({ ...noGps, latitude: 11.9, longitude: 79.8, actorRole: "COMPANY_ADMIN", employeeId: "emp-1", workMode: "WORK_FROM_HOME" }),
      (e) => e.code === "DAY_OFF_APPROVAL_REQUIRED",
    );
  });
});
