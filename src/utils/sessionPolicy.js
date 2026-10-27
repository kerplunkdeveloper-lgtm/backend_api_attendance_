const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const SESSION_UNLIMITED = Infinity;

// Session lifetime is an absolute maximum from sign-in. Refresh-token rotation
// never extends this window.
const SESSION_POLICY = Object.freeze({
  EMPLOYEE: 30 * DAY_MS,
  MANAGER: 30 * DAY_MS,       // HR role in the current schema
  COMPANY_ADMIN: 30 * DAY_MS,
  SUPER_ADMIN: SESSION_UNLIMITED,
});

const getSessionMaxAgeMs = (role) => SESSION_POLICY[role] || SESSION_POLICY.EMPLOYEE;

const getSessionExpiryMessage = (role) => {
  if (role === 'SUPER_ADMIN') return 'Super Admin sessions do not expire automatically.';
  return 'Your 30-day session has expired. Please log in again.';
};

module.exports = { DAY_MS, MINUTE_MS, SESSION_UNLIMITED, SESSION_POLICY, getSessionMaxAgeMs, getSessionExpiryMessage };
