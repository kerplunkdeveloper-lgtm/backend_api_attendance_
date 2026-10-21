const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

// Session lifetime is an absolute maximum from sign-in. Refresh-token rotation
// never extends this window.
const SESSION_POLICY = Object.freeze({
  EMPLOYEE: 30 * DAY_MS,
  MANAGER: 30 * DAY_MS,       // HR role in the current schema
  COMPANY_ADMIN: 15 * DAY_MS,
  SUPER_ADMIN: 30 * MINUTE_MS,
});

const getSessionMaxAgeMs = (role) => SESSION_POLICY[role] || SESSION_POLICY.EMPLOYEE;

const getSessionExpiryMessage = (role) => {
  if (role === 'SUPER_ADMIN') return 'Your 30-minute owner session has expired. Please log in again.';
  if (role === 'COMPANY_ADMIN') return 'Your 15-day admin session has expired. Please log in again.';
  return 'Your 30-day session has expired. Please log in again.';
};

module.exports = { DAY_MS, MINUTE_MS, SESSION_POLICY, getSessionMaxAgeMs, getSessionExpiryMessage };
