const test = require("node:test");
const assert = require("node:assert/strict");
const { assetRules } = require("../src/utils/assetRules");

const code = (fn) => { try { fn(); return null; } catch (e) { return e.statusCode; } };
const WORKING = ["ACTIVE", "PROBATION", "NOTICE_PERIOD"];

test("only an available asset can be assigned", () => {
  assert.equal(code(() => assetRules.assertAssignable({ status: "AVAILABLE", assignedToId: null })), null);
  assert.equal(code(() => assetRules.assertAssignable({ status: "ASSIGNED", assignedToId: "e1", assetCode: "LAP-1" })), 409);
  for (const status of ["UNDER_MAINTENANCE", "DAMAGED", "RETIRED", "LOST"]) {
    assert.equal(code(() => assetRules.assertAssignable({ status, assignedToId: null })), 409, status);
  }
});

test("a transfer needs a held asset and a different person", () => {
  assert.equal(code(() => assetRules.assertTransferable({ status: "ASSIGNED", assignedToId: "e1" }, { id: "e2" })), null);
  assert.equal(code(() => assetRules.assertTransferable({ status: "AVAILABLE", assignedToId: null }, { id: "e2" })), 409);
  assert.equal(code(() => assetRules.assertTransferable({ status: "ASSIGNED", assignedToId: "e1" }, { id: "e1" })), 409);
});

test("people who have left cannot receive equipment, but people serving notice can", () => {
  assert.equal(code(() => assetRules.assertWorking({ status: "NOTICE_PERIOD" }, WORKING)), null);
  assert.equal(code(() => assetRules.assertWorking({ status: "TERMINATED" }, WORKING)), 409);
  assert.equal(code(() => assetRules.assertWorking({ status: "INACTIVE" }, WORKING)), 409);
});

test("status edits cannot contradict custody", () => {
  const held = { status: "ASSIGNED", assignedToId: "e1" };
  const shelf = { status: "AVAILABLE", assignedToId: null };
  assert.equal(code(() => assetRules.assertStatusChange(held, "AVAILABLE")), 409);
  assert.equal(code(() => assetRules.assertStatusChange(shelf, "ASSIGNED")), 409);
  assert.equal(code(() => assetRules.assertStatusChange(shelf, "RETIRED")), null);
  assert.equal(code(() => assetRules.assertStatusChange(held, "ASSIGNED")), null);
  assert.equal(code(() => assetRules.assertStatusChange(shelf, "BROKEN")), 400);
});

test("validates cost, dates and the warranty window", () => {
  assert.deepEqual(assetRules.validateDetails({ purchaseCost: "1500.456" }), { purchaseCost: 1500.46 });
  assert.equal(code(() => assetRules.validateDetails({ purchaseCost: -5 })), 400);
  assert.equal(code(() => assetRules.validateDetails({ purchaseCost: "abc" })), 400);
  assert.equal(code(() => assetRules.validateDetails({ purchaseDate: "nope" })), 400);
  assert.equal(code(() => assetRules.validateDetails({ purchaseDate: "2026-05-01", warrantyExpiry: "2026-01-01" })), 400);
  assert.deepEqual(assetRules.validateDetails({}), {});
});

test("return input is validated and dues accumulate", () => {
  assert.deepEqual(assetRules.validateReturn({ conditionOnReturn: "damaged", recoveryCharge: "500" }), { conditionOnReturn: "DAMAGED", recoveryCharge: 500 });
  assert.equal(code(() => assetRules.validateReturn({ conditionOnReturn: "BROKEN" })), 400);
  assert.equal(code(() => assetRules.validateReturn({ recoveryCharge: -1 })), 400);
  assert.equal(assetRules.addDue(1200, 300), 1500);
  assert.equal(assetRules.addDue(null, 0), 0);
});
