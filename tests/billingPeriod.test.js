const test = require("node:test");
const assert = require("node:assert/strict");
const { addBillingPeriod } = require("../src/config/plans");

const iso = (d) => d.toISOString();

test("a monthly period from the 31st ends on the last day of the next month, not the 3rd", () => {
  assert.equal(iso(addBillingPeriod("2026-01-31T10:00:00Z", "MONTHLY")).slice(0, 10), "2026-02-28");
  assert.equal(iso(addBillingPeriod("2028-01-31T10:00:00Z", "MONTHLY")).slice(0, 10), "2028-02-29");
  assert.equal(iso(addBillingPeriod("2026-03-31T10:00:00Z", "MONTHLY")).slice(0, 10), "2026-04-30");
});

test("ordinary monthly and annual periods keep the day and time", () => {
  assert.equal(iso(addBillingPeriod("2026-10-23T08:30:00Z", "MONTHLY")), "2026-11-23T08:30:00.000Z");
  assert.equal(iso(addBillingPeriod("2026-10-23T08:30:00Z", "ANNUAL")), "2027-10-23T08:30:00.000Z");
});

test("an annual period from 29 February lands on 28 February the next year", () => {
  assert.equal(iso(addBillingPeriod("2028-02-29T00:00:00Z", "ANNUAL")).slice(0, 10), "2029-02-28");
});

test("December rolls into January of the next year", () => {
  assert.equal(iso(addBillingPeriod("2026-12-15T00:00:00Z", "MONTHLY")).slice(0, 10), "2027-01-15");
});
