// Indian mobile numbers: 10 digits, first digit 6-9. Stored as E.164 (+91XXXXXXXXXX).
const INDIAN_MOBILE_REGEX = /^[6-9]\d{9}$/;

/**
 * Accepts "9876543210", "+91 98765 43210", "91-9876543210", "09876543210".
 * Returns "+919876543210", or null when empty, or throws a 400 error when invalid.
 */
const normalizeIndianPhone = (value, label = "Phone number") => {
  if (value === undefined || value === null || String(value).trim() === "") return null;

  let digits = String(value).replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);

  if (!INDIAN_MOBILE_REGEX.test(digits)) {
    const error = new Error(`${label} must be a valid 10-digit Indian mobile number (starting with 6-9)`);
    error.statusCode = 400;
    throw error;
  }
  return `+91${digits}`;
};

module.exports = { normalizeIndianPhone, INDIAN_MOBILE_REGEX };
