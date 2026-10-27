const test = require("node:test");
const assert = require("node:assert/strict");
const {
  validateIdentityFields,
  validateNewEmployeeProfile,
  assertRequiredNotCleared,
  assertStatus,
  parsePastDate,
} = require("../src/utils/employeeValidation");

const completeProfile = () => ({
  firstName: " Asha ",
  lastName: "Rao",
  email: "Asha@Example.com ",
  phone: "+91 98765-43210",
  gender: "female",
  dateOfBirth: "1995-04-12",
  dateOfJoining: "2026-11-01",
  designation: "Engineer",
  employmentType: "full_time",
  branchId: "b1",
  departmentId: "d1",
  shiftId: "s1",
  address: "12 MG Road, Pune",
  emergencyContactName: "Ravi Rao",
  emergencyContactPhone: "9123456780",
  bankName: "HDFC Bank",
  bankAccountNumber: "50100123456",
  bankIfsc: "hdfc0001234",
  ctc: "900000",
});

test("a complete profile passes without PAN, UAN or ESI", () => {
  const profile = validateNewEmployeeProfile(completeProfile());
  assert.equal(profile.email, "asha@example.com");
  assert.equal(profile.firstName, "Asha");
  assert.equal(profile.gender, "FEMALE");
  assert.equal(profile.employmentType, "FULL_TIME");
  assert.equal(profile.phone, "+919876543210");
  assert.equal(profile.bankIfsc, "HDFC0001234");
  assert.equal(profile.ctc, 900000);
  assert.equal(profile.panNumber, null);
  assert.equal(profile.uanNumber, null);
  assert.equal(profile.esiNumber, null);
});

test("optional identity numbers are still format-checked when given", () => {
  const profile = validateNewEmployeeProfile({ ...completeProfile(), panNumber: "abcde1234f", uanNumber: "100200300400", esiNumber: "12345678901234567" });
  assert.equal(profile.panNumber, "ABCDE1234F");
  assert.equal(profile.esiNumber, "12345678901234567");
  assert.throws(() => validateNewEmployeeProfile({ ...completeProfile(), esiNumber: "123" }), /ESI number is not valid/);
});

test("every missing mandatory field is reported in one message", () => {
  assert.throws(
    () => validateNewEmployeeProfile({ ...completeProfile(), phone: "", address: " ", bankIfsc: undefined }),
    (err) => err.statusCode === 400 && /Phone, Address, IFSC code/.test(err.message),
  );
});

test("rejects bad email, phone, gender, employment type and CTC", () => {
  for (const patch of [{ email: "nope" }, { phone: "12345" }, { gender: "OTHER" }, { employmentType: "FREELANCE" }, { ctc: "-5" }, { ctc: "abc" }, { dateOfBirth: "2999-01-01" }]) {
    assert.throws(() => validateNewEmployeeProfile({ ...completeProfile(), ...patch }), (err) => err.statusCode === 400, JSON.stringify(patch));
  }
});

test("personal email is optional, lower-cased and format-checked", () => {
  assert.equal(validateNewEmployeeProfile(completeProfile()).personalEmail, null);
  assert.equal(validateNewEmployeeProfile({ ...completeProfile(), personalEmail: " Asha.Rao@Gmail.com " }).personalEmail, "asha.rao@gmail.com");
  assert.throws(() => validateNewEmployeeProfile({ ...completeProfile(), personalEmail: "nope" }), /Personal email is not valid/);
});

test("an edit cannot clear a required field", () => {
  assert.doesNotThrow(() => assertRequiredNotCleared({ panNumber: "", uanNumber: "", esiNumber: "", firstName: "Asha" }));
  assert.throws(() => assertRequiredNotCleared({ gender: "" }), /Gender/);
});

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
