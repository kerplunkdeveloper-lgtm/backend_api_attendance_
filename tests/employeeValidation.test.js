const test = require("node:test");
const assert = require("node:assert/strict");
const { validateIdentityFields, assertStatus, parsePastDate } = require("../src/utils/employeeValidation");

test("normalises and accepts well-formed PAN, IFSC, UAN and account numbers", () => {
  assert.deepEqual(
    validateIdentityFields({ panNumber: " abcde1234f ", bankIfsc: "hdfc0001234", uanNumber: "1002 0030 0400", bankAccountNumber: "50100 123456" }),
    { panNumber: "ABCDE1234F", bankIfsc: "HDFC0001234", uanNumber: "100200300400", bankAccountNumber: "50100123456" },
  );
});

test("rejects malformed values with a clear 400", () => {
  for (const data of [{ panNumber: "ABC123" }, { bankIfsc: "HDFC1001234" }, { uanNumber: "12345" }, { bankAccountNumber: "12ab" }]) {
    assert.throws(() => validateIdentityFields(data), (err) => err.statusCode === 400 && /not valid/.test(err.message), JSON.stringify(data));
  }
});

test("blank clears the field and absent fields are left alone", () => {
  assert.deepEqual(validateIdentityFields({ panNumber: "", uanNumber: null }), { panNumber: null, uanNumber: null });
  assert.deepEqual(validateIdentityFields({}), {});
});

test("status must be a real employment status", () => {
  assert.equal(assertStatus("NOTICE_PERIOD"), "NOTICE_PERIOD");
  assert.throws(() => assertStatus("FIRED"), (err) => err.statusCode === 400);
});

test("dates must be real and not in the future", () => {
  assert.equal(parsePastDate("Date of birth", ""), null);
  assert.ok(parsePastDate("Date of birth", "1995-04-12") instanceof Date);
  assert.throws(() => parsePastDate("Date of birth", "not-a-date"), /not a valid date/);
  assert.throws(() => parsePastDate("Date of birth", "2999-01-01"), /future/);
  assert.ok(parsePastDate("Joining date", "2999-01-01", { allowFuture: true }) instanceof Date);
});
