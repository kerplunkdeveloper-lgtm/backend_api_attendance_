const EMPLOYEE_BACKDATE_MS = 12 * 60 * 60 * 1000;
const ADMIN_BACKDATE_MS = 7 * 24 * 60 * 60 * 1000;
const FUTURE_SKEW_MS = 5 * 60 * 1000;
const DEVICE_SKEW_MS = 15 * 60 * 1000;

const ADMIN_ROLES = ["SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"];

/**
 * Rejects punch timestamps that are too far in the future or too far back.
 * Device punches get a tighter window than interactive admin corrections.
 */
const assertPunchTimestamp = (timestamp, { actorRole = "EMPLOYEE", source = "WEB", now = new Date() } = {}) => {
  const at = timestamp ? new Date(timestamp) : now;
  if (Number.isNaN(at.getTime())) {
    const err = new Error("Invalid timestamp");
    err.statusCode = 400;
    throw err;
  }

  const delta = at.getTime() - now.getTime();
  const futureLimit = source === "BIOMETRIC" || source === "DEVICE" ? DEVICE_SKEW_MS : FUTURE_SKEW_MS;
  if (delta > futureLimit) {
    const err = new Error("Punch timestamp is too far in the future");
    err.statusCode = 400;
    throw err;
  }

  const backLimit =
    source === "BIOMETRIC" || source === "DEVICE"
      ? DEVICE_SKEW_MS
      : ADMIN_ROLES.includes(actorRole)
        ? ADMIN_BACKDATE_MS
        : EMPLOYEE_BACKDATE_MS;

  if (-delta > backLimit) {
    const err = new Error("Punch timestamp is outside the allowed backdate window");
    err.statusCode = 400;
    throw err;
  }

  return at;
};

module.exports = { assertPunchTimestamp, EMPLOYEE_BACKDATE_MS, ADMIN_BACKDATE_MS, FUTURE_SKEW_MS, DEVICE_SKEW_MS };
