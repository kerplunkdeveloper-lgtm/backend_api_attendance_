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
  aadhaarNumber: { label: "Aadhaar number", pattern: /^\d{12}$/, hint: "12 digits" },
  bankAccountNumber: { label: "Bank account number", pattern: /^\d{6,20}$/, hint: "6 to 20 digits" },
};

/** Validates the identity fields present in `data`; returns the normalised values for those fields. */
const validateIdentityFields = (data) => {
  const out = {};
  for (const [key, { label, pattern, hint, upper }] of Object.entries(FORMATS)) {
    if (data[key] === undefined) continue;
    if (blank(data[key])) {
      out[key] = null;
      continue;
    }
    const value = String(data[key]).replace(/\s+/g, "");
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

module.exports = { validateIdentityFields, assertStatus, parsePastDate, EMPLOYEE_STATUSES };
