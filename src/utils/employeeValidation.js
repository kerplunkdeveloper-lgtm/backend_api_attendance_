/**
 * Format checks for employee identity and bank fields. These values flow into the PF ECR file, ESI
 * return and NEFT bank upload, all of which reject malformed entries, so they are checked when entered.
 * Blank values are always allowed (the field is optional).
 */

const EMPLOYEE_STATUSES = ["ACTIVE", "INACTIVE", "TERMINATED", "PROBATION", "NOTICE_PERIOD"];

const fail = (message) => {
  const error = new Error(message);
  error.statusCode = 400;
  throw error;
};

const blank = (value) => value === undefined || value === null || String(value).trim() === "";

const FORMATS = {
  panNumber: { label: "PAN", pattern: /^[A-Z]{5}[0-9]{4}[A-Z]$/, hint: "like ABCDE1234F", upper: true },
  bankIfsc: { label: "IFSC code", pattern: /^[A-Z]{4}0[A-Z0-9]{6}$/, hint: "like HDFC0001234", upper: true },
  uanNumber: { label: "UAN", pattern: /^\d{12}$/, hint: "12 digits" },
  esiNumber: { label: "ESI number", pattern: /^\d{17}$/, hint: "17 digits" },
  aadhaarNumber: { label: "Aadhaar number", pattern: /^\d{12}$/, hint: "12 digits" },
  bankAccountNumber: { label: "Bank account number", pattern: /^\d{6,20}$/, hint: "6 to 20 digits" },
  phone: { label: "Phone number", pattern: /^\+?\d{10,15}$/, hint: "10 to 15 digits", strip: /[\s\-()]/g },
  emergencyContactPhone: { label: "Emergency contact phone", pattern: /^\+?\d{10,15}$/, hint: "10 to 15 digits", strip: /[\s\-()]/g },
};

/** Validates the identity fields present in `data`; returns the normalised values for those fields. */
const validateIdentityFields = (data) => {
  const out = {};
  for (const [key, { label, pattern, hint, upper, strip }] of Object.entries(FORMATS)) {
    if (data[key] === undefined) continue;
    if (blank(data[key])) {
      out[key] = null;
      continue;
    }
    const value = String(data[key]).replace(strip || /\s+/g, "");
    const normalized = upper ? value.toUpperCase() : value;
    if (!pattern.test(normalized)) fail(`${label} is not valid (${hint}).`);
    out[key] = normalized;
  }
  return out;
};

const assertStatus = (status) => {
  if (!EMPLOYEE_STATUSES.includes(String(status))) fail(`Status must be one of ${EMPLOYEE_STATUSES.join(", ")}.`);
  return String(status);
};

/** A real date that is not in the future (birth and joining dates). Blank means "not set". */
const parsePastDate = (label, value, { allowFuture = false } = {}) => {
  if (blank(value)) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) fail(`${label} is not a valid date.`);
  if (!allowFuture && date.getTime() > Date.now() + 24 * 60 * 60 * 1000) fail(`${label} cannot be in the future.`);
  return date;
};

const GENDER_VALUES = ["MALE", "FEMALE"];

/** Blank means "not recorded". Anything else must be Male or Female. */
const normalizeGender = (value) => {
  if (blank(value) || String(value).trim().toUpperCase() === "NOT_SPECIFIED") return null;
  const gender = String(value).trim().toUpperCase();
  if (!GENDER_VALUES.includes(gender)) fail("Gender must be Male or Female");
  return gender;
};

const EMPLOYMENT_TYPES = ["FULL_TIME", "PART_TIME", "CONTRACT", "INTERN"];

const normalizeEmploymentType = (value) => {
  if (blank(value)) return null;
  const type = String(value).trim().toUpperCase();
  if (!EMPLOYMENT_TYPES.includes(type)) fail(`Employment type must be one of ${EMPLOYMENT_TYPES.join(", ")}.`);
  return type;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Fields a new employee record must carry, by manual entry or email invite. PAN, UAN and ESI are the
 * only optional ones: not every employee has them yet. The employee code is auto-generated and the
 * role defaults to Employee, so neither is listed.
 */
const REQUIRED_NEW_EMPLOYEE_FIELDS = [
  ["firstName", "First name"],
  ["lastName", "Last name"],
  ["email", "Email"],
  ["phone", "Phone"],
  ["gender", "Gender"],
  ["dateOfBirth", "Date of birth"],
  ["dateOfJoining", "Date of joining"],
  ["designation", "Designation"],
  ["employmentType", "Employment type"],
  ["branchId", "Branch"],
  ["departmentId", "Department"],
  ["shiftId", "Shift"],
  ["address", "Address"],
  ["emergencyContactName", "Emergency contact name"],
  ["emergencyContactPhone", "Emergency contact phone"],
  ["bankName", "Bank name"],
  ["bankAccountNumber", "Bank account number"],
  ["bankIfsc", "IFSC code"],
  ["ctc", "Annual CTC"],
];

/** Profile fields that can be edited later but never blanked, because they are required at creation. */
const REQUIRED_WHEN_PRESENT = new Set(
  REQUIRED_NEW_EMPLOYEE_FIELDS.map(([key]) => key).filter((key) => key !== "email" && key !== "ctc"),
);
const FIELD_LABELS = Object.fromEntries(REQUIRED_NEW_EMPLOYEE_FIELDS);

const parseAnnualCtc = (value) => {
  const ctc = Number(value);
  if (!Number.isFinite(ctc) || ctc <= 0) fail("Annual CTC must be a number greater than 0.");
  return ctc;
};

/**
 * Validates a manual-entry or email-invite payload as a whole and returns the normalised profile
 * columns. Every missing field is reported in one message so the form can be fixed in a single pass.
 */
const validateNewEmployeeProfile = (data) => {
  const missing = REQUIRED_NEW_EMPLOYEE_FIELDS.filter(([key]) => blank(data[key])).map(([, label]) => label);
  if (missing.length) fail(`Please fill in the required fields: ${missing.join(", ")}.`);

  const email = String(data.email).trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email)) fail("Email is not valid.");

  const identity = validateIdentityFields(data);
  const text = (value) => (blank(value) ? null : String(value).trim());
  return {
    email,
    firstName: String(data.firstName).trim(),
    lastName: String(data.lastName).trim(),
    gender: normalizeGender(data.gender) || fail("Gender must be Male or Female"),
    dateOfBirth: parsePastDate("Date of birth", data.dateOfBirth),
    dateOfJoining: parsePastDate("Date of joining", data.dateOfJoining, { allowFuture: true }),
    employmentType: normalizeEmploymentType(data.employmentType),
    designation: text(data.designation),
    address: text(data.address),
    emergencyContactName: text(data.emergencyContactName),
    bankName: text(data.bankName),
    ctc: parseAnnualCtc(data.ctc),
    // Optional: null when left blank.
    panNumber: identity.panNumber ?? null,
    uanNumber: identity.uanNumber ?? null,
    esiNumber: identity.esiNumber ?? null,
    phone: identity.phone,
    emergencyContactPhone: identity.emergencyContactPhone,
    bankAccountNumber: identity.bankAccountNumber,
    bankIfsc: identity.bankIfsc,
  };
};

/** On edit, a required profile field may be changed but not cleared. Absent keys are left alone. */
const assertRequiredNotCleared = (data) => {
  const cleared = Object.keys(FIELD_LABELS).filter(
    (key) => REQUIRED_WHEN_PRESENT.has(key) && data[key] !== undefined && blank(data[key]),
  );
  if (cleared.length) fail(`These fields cannot be left empty: ${cleared.map((key) => FIELD_LABELS[key]).join(", ")}.`);
};

module.exports = {
  validateIdentityFields,
  validateNewEmployeeProfile,
  assertRequiredNotCleared,
  normalizeGender,
  normalizeEmploymentType,
  assertStatus,
  parsePastDate,
  EMPLOYEE_STATUSES,
  EMPLOYMENT_TYPES,
};
