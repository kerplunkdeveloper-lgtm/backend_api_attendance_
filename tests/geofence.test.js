const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { officeOnlyRejection, formatDistance } = require("../src/utils/geofence");

// Andheri office, 200 m radius.
const office = { name: "Andheri office", latitude: "19.1197", longitude: "72.8468", radiusMeters: 200 };

describe("office-only check-in", () => {
  it("allows a punch inside the branch radius", () => {
    assert.equal(officeOnlyRejection({ latitude: 19.1198, longitude: 72.8469, accuracy: 20, branches: [office] }), null);
  });

  it("allows everyone when no branch has coordinates configured", () => {
    assert.equal(officeOnlyRejection({ latitude: null, longitude: null, accuracy: null, branches: [] }), null);
  });

  it("asks for location instead of silently letting a punch without GPS through", () => {
    const result = officeOnlyRejection({ latitude: null, longitude: null, accuracy: null, branches: [office] });
    assert.equal(result.code, "LOCATION_REQUIRED");
    assert.match(result.message, /Turn on location/);
  });

  it("names the distance and the office when the employee is clearly away", () => {
    // ~2.2 km north of the office, accurate to 15 m.
    const result = officeOnlyRejection({ latitude: 19.1397, longitude: 72.8468, accuracy: 15, branches: [office] });
    assert.equal(result.code, "OUTSIDE_OFFICE");
    assert.match(result.message, /about 2\.2 km from Andheri office/);
    assert.match(result.message, /within 200 m/);
    assert.doesNotMatch(result.message, /Work from home/);
    assert.equal(result.details.allowedRadiusMeters, 200);
  });

  it("suggests Work from home only when the organization allows it", () => {
    const result = officeOnlyRejection({ latitude: 19.1397, longitude: 72.8468, accuracy: 15, branches: [office], allowWfh: true });
    assert.match(result.message, /Work from home, Client visit or Travel/);
  });

  it("asks for a better fix when a fuzzy location could still be inside the office", () => {
    // IP-based fix 12 km away with a 140 km error circle.
    const result = officeOnlyRejection({ latitude: 19.2277, longitude: 72.8468, accuracy: 140000, branches: [office] });
    assert.equal(result.code, "LOCATION_IMPRECISE");
    assert.match(result.message, /couldn't pinpoint your location/);
    assert.match(result.message, /140 km/);
  });

  it("accepts a punch inside any branch, not only the nearest centre", () => {
    const warehouse = { name: "Bhiwandi warehouse", latitude: "19.2813", longitude: "73.0483", radiusMeters: 500 };
    assert.equal(officeOnlyRejection({ latitude: 19.2815, longitude: 73.0485, accuracy: 30, branches: [office, warehouse] }), null);
  });
});

describe("formatDistance", () => {
  it("uses metres under a kilometre and km above", () => {
    assert.equal(formatDistance(184.4), "184 m");
    assert.equal(formatDistance(2212), "2.2 km");
    assert.equal(formatDistance(140000), "140 km");
  });
});
