const test = require("node:test");
const assert = require("node:assert/strict");
const { parseCoordinates, parseRadius } = require("../src/utils/branchValidation");

test("accepts real coordinates, strings included, and blanks as no location", () => {
  assert.deepEqual(parseCoordinates("13.0827", "80.2707"), { latitude: 13.0827, longitude: 80.2707 });
  assert.deepEqual(parseCoordinates("", null), { latitude: null, longitude: null });
});

test("rejects NaN, out-of-range, and half-specified coordinates", () => {
  assert.throws(() => parseCoordinates("abc", "80"), (e) => e.statusCode === 400);
  assert.throws(() => parseCoordinates("91", "80"), /Latitude/);
  assert.throws(() => parseCoordinates("13", "181"), /Longitude/);
  assert.throws(() => parseCoordinates("13", ""), /both latitude and longitude/);
});

test("radius must be a sensible whole number of metres", () => {
  assert.equal(parseRadius(undefined), 200);
  assert.equal(parseRadius("150"), 150);
  for (const bad of [0, -5, 5, 50000, "abc", 12.5]) assert.throws(() => parseRadius(bad), (e) => e.statusCode === 400, String(bad));
});
