const { describe, it, beforeEach, afterEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const { mockPrisma, stubSideEffects } = require("./helpers/mockPrisma");

stubSideEffects();

let lastFindManyArgs;
const row = {
  id: "att-1",
  employeeId: "emp-1",
  checkIn: new Date("2026-10-26T04:00:00Z"),
  checkOut: new Date("2026-10-26T12:00:00Z"),
  checkInLocation: "Head Office",
  checkOutLocation: "Anna Nagar, Chennai",
  checkInLatitude: "13.0762000",
  checkInLongitude: "80.2609000",
  checkOutLatitude: "13.0850000",
  checkOutLongitude: "80.2101000",
  wfhNote: "Client call",
  events: [{ id: "e1", type: "CHECK_IN", latitude: "13.0762000", longitude: "80.2609000", accuracy: "12.00" }],
};

mockPrisma({
  employee: { findFirst: async () => ({ id: "emp-1" }) },
  attendance: {
    findMany: async (args) => {
      lastFindManyArgs = args;
      return [JSON.parse(JSON.stringify(row))];
    },
    count: async () => 1,
  },
});

const attendance = require("../src/services/attendance.service");
const { resolvePunchLocation } = require("../src/utils/reverseGeocode");

const history = (role) => attendance.getAttendanceHistory({ userId: "u-1", organizationId: "org-1", role });

describe("who can see where someone punched", () => {
  for (const role of ["COMPANY_ADMIN", "SUPER_ADMIN", "MANAGER"]) {
    it(`${role} gets place names, coordinates and the branch position`, async () => {
      const { records } = await history(role);
      assert.equal(records[0].checkInLocation, "Head Office");
      assert.equal(records[0].checkOutLocation, "Anna Nagar, Chennai");
      assert.equal(records[0].checkOutLatitude, "13.0850000");
      assert.equal(records[0].events[0].latitude, "13.0762000");
      assert.deepEqual(lastFindManyArgs.include.branch.select, { id: true, name: true, radiusMeters: true, latitude: true, longitude: true });
    });
  }

  it("an employee gets their record without any place names or GPS", async () => {
    const { records } = await history("EMPLOYEE");
    const record = records[0];
    for (const key of ["checkInLocation", "checkOutLocation", "checkInLatitude", "checkInLongitude", "checkOutLatitude", "checkOutLongitude"]) {
      assert.equal(key in record, false, `${key} must not be sent to an employee`);
    }
    assert.equal("latitude" in record.events[0], false);
    assert.equal("longitude" in record.events[0], false);
    assert.equal("accuracy" in record.events[0], false);
    // The rest of the record is untouched.
    assert.equal(record.wfhNote, "Client call");
    assert.equal(record.events[0].type, "CHECK_IN");
    // And the branch's own coordinates are never selected for them.
    assert.deepEqual(lastFindManyArgs.include.branch.select, { id: true, name: true, radiusMeters: true });
  });
});

describe("an employee's own attendance list", () => {
  it("leaves out place names and GPS for an employee", async () => {
    const { records } = await attendance.getMyAttendance("u-1", "org-1", {}, "EMPLOYEE");
    assert.equal("checkInLocation" in records[0], false);
    assert.equal("checkOutLatitude" in records[0], false);
    assert.equal("latitude" in records[0].events[0], false);
    assert.equal(records[0].wfhNote, "Client call");
  });

  it("keeps them for HR and admins looking at their own record", async () => {
    for (const role of ["MANAGER", "COMPANY_ADMIN"]) {
      const { records } = await attendance.getMyAttendance("u-1", "org-1", {}, role);
      assert.equal(records[0].checkInLocation, "Head Office");
    }
  });
});

describe("the place saved with a punch", () => {
  const realFetch = global.fetch;
  let lookups;
  beforeEach(() => {
    lookups = 0;
    global.fetch = mock.fn(async () => {
      lookups += 1;
      return { ok: true, json: async () => ({ address: { suburb: "Velachery", city: "Chennai", state: "Tamil Nadu" } }) };
    });
  });
  afterEach(() => {
    global.fetch = realFetch;
  });

  it("uses the branch name only for an office punch inside that branch", async () => {
    assert.equal(await resolvePunchLocation({ workMode: "OFFICE", branchName: "Head Office", latitude: 13.07, longitude: 80.26 }), "Head Office");
    assert.equal(lookups, 0);
  });

  it("does not call a work-from-home punch 'Head Office'", async () => {
    const label = await resolvePunchLocation({ workMode: "WORK_FROM_HOME", branchName: "Head Office", latitude: 12.98, longitude: 80.22 });
    assert.equal(label, "Work from home · Velachery, Chennai, Tamil Nadu");
  });

  it("looks the place up from the coordinates when the app sent none and the punch is outside every branch", async () => {
    assert.equal(await resolvePunchLocation({ workMode: "OFFICE", latitude: 12.98, longitude: 80.22 }), "Velachery, Chennai, Tamil Nadu");
  });

  it("prefers the place name the app sent, and ignores raw municipal ward strings", async () => {
    assert.equal(await resolvePunchLocation({ locationLabel: "Client site, OMR", latitude: 12.9, longitude: 80.2 }), "Client site, OMR");
    assert.equal(lookups, 0);
    assert.equal(await resolvePunchLocation({ locationLabel: "Ward 62, Chennai, Tamil Nadu", latitude: 12.9, longitude: 80.2 }), "Velachery, Chennai, Tamil Nadu");
  });

  it("still saves something readable when there is no GPS and the lookup fails", async () => {
    global.fetch = async () => {
      throw new Error("offline");
    };
    assert.equal(await resolvePunchLocation({ workMode: "TRAVEL" }), "Travel / field");
    assert.equal(await resolvePunchLocation({}), "Office");
  });
});
