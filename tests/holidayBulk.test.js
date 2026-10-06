const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { mockPrisma, stubSideEffects } = require("./helpers/mockPrisma");

stubSideEffects();

const calls = { findMany: 0, createMany: 0, created: [] };

const prisma = {
  branch: { findMany: async () => [{ id: "branch-1-uuid-0000000000000", name: "HQ" }] },
  holiday: {
    findMany: async () => {
      calls.findMany += 1;
      return [{ date: new Date("2026-01-26T00:00:00.000Z"), branchId: null, name: "Republic Day" }];
    },
    createMany: async ({ data }) => {
      calls.createMany += 1;
      calls.created.push(...data);
      return { count: data.length };
    },
  },
  // Interactive transactions time out on remote databases for long lists.
  $transaction() {
    throw new Error("bulk holiday import must not use an interactive transaction");
  },
};
mockPrisma(prisma);

const holidayService = require("../src/services/holiday.service");

describe("bulk holiday import", () => {
  it("imports a large list with constant query count and no interactive transaction", async () => {
    const list = Array.from({ length: 400 }, (_, i) => ({
      name: `Holiday ${i}`,
      date: new Date(Date.UTC(2026, 0, 1 + (i % 28))).toISOString(),
    }));
    const result = await holidayService.bulkCreateHolidays("org-a", list);

    assert.equal(result.created, 400);
    assert.equal(calls.findMany, 1);
    assert.equal(calls.createMany, 1);
  });

  it("skips existing, in-batch duplicate and invalid rows and resolves branch names", async () => {
    calls.created.length = 0;
    const result = await holidayService.bulkCreateHolidays("org-a", [
      { name: "Republic Day", date: "2026-01-26" },
      { name: "Founders Day", date: "2026-03-02", branch: "hq", type: "company" },
      { name: "Founders Day", date: "2026-03-02", branch: "HQ" },
      { name: "Bad Date", date: "not-a-date" },
      { date: "2026-04-01" },
    ]);

    assert.equal(result.created, 1);
    assert.equal(result.skipped, 4);
    assert.equal(calls.created.at(-1).branchId, "branch-1-uuid-0000000000000");
    assert.equal(calls.created.at(-1).type, "COMPANY");
  });

  it("rejects empty and oversized lists with a 400", async () => {
    await assert.rejects(() => holidayService.bulkCreateHolidays("org-a", []), (e) => e.statusCode === 400);
    const big = Array.from({ length: 1001 }, (_, i) => ({ name: `H${i}`, date: "2026-05-01" }));
    await assert.rejects(() => holidayService.bulkCreateHolidays("org-a", big), (e) => e.statusCode === 400);
  });
});
