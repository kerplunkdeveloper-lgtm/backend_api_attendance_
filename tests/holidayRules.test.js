const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { mockPrisma, stubSideEffects } = require("./helpers/mockPrisma");

stubSideEffects();

let created;
let upcomingWhere;

mockPrisma({
  organization: { findUnique: async () => ({ timezone: "Asia/Kolkata" }) },
  branch: {
    findFirst: async ({ where }) => (where.id === "b1" ? { id: "b1" } : null),
    findMany: async () => [{ id: "b1", name: "Chennai" }],
  },
  holiday: {
    findFirst: async () => null,
    findMany: async (args) => {
      upcomingWhere = args.where;
      return [];
    },
    create: async ({ data }) => data,
    createMany: async ({ data }) => {
      created = data;
      return { count: data.length };
    },
  },
});

const holidays = require("../src/services/holiday.service");

beforeEach(() => {
  created = [];
});

describe("holiday validation", () => {
  it("rejects an invalid date instead of storing it", async () => {
    await assert.rejects(holidays.createHoliday("org-1", { name: "Pongal", date: "not-a-date" }), (e) => e.statusCode === 400 && /valid holiday date/.test(e.message));
  });

  it("rejects a blank or oversized name", async () => {
    await assert.rejects(holidays.createHoliday("org-1", { name: "   ", date: "2026-01-14" }), (e) => e.statusCode === 400);
    await assert.rejects(holidays.createHoliday("org-1", { name: "x".repeat(121), date: "2026-01-14" }), /120 characters/);
  });

  it("does not crash on a non-string type", async () => {
    const holiday = await holidays.createHoliday("org-1", { name: "Pongal", date: "2026-01-14", type: 5 });
    assert.equal(holiday.type, "GOVERNMENT");
  });
});

describe("bulk import", () => {
  it("skips a row whose branch name is unknown instead of making it company-wide", async () => {
    const result = await holidays.bulkCreateHolidays("org-1", [
      { name: "Pongal", date: "2026-01-14", branch: "Chennai" },
      { name: "Onam", date: "2026-09-05", branch: "Mumbay" },
      { name: "Republic Day", date: "2026-01-26" },
    ]);
    assert.equal(result.created, 2);
    assert.equal(result.skipped, 1);
    assert.match(result.errors[0], /Unknown branch 'Mumbay'/);
    assert.deepEqual(created.map((h) => [h.name, h.branchId]), [["Pongal", "b1"], ["Republic Day", null]]);
  });
});

describe("upcoming holidays", () => {
  it("counts from the company's own calendar day", async () => {
    await holidays.getUpcomingHolidays("org-1", null, 5);
    const gte = upcomingWhere.date.gte;
    assert.ok(gte instanceof Date);
    assert.equal(gte.getUTCHours(), 0);
  });
});
