const crypto = require("crypto");

/** One-time login password. Never reuse a static default. */
const generateTempPassword = () =>
  `TMP-${crypto.randomBytes(3).toString("hex").toUpperCase()}${crypto.randomInt(1000, 9999)}`;

/**
 * Roles an actor may assign when creating a user through employee/onboarding APIs.
 * SUPER_ADMIN and COMPANY_ADMIN are never accepted from a request body.
 */
const resolveAssignableRole = (requestedRole, actorRole = "COMPANY_ADMIN") => {
  const requested = requestedRole === "HR" ? "MANAGER" : requestedRole || "EMPLOYEE";

  if (requested === "SUPER_ADMIN" || requested === "COMPANY_ADMIN") {
    const error = new Error("This role cannot be assigned through employee create");
    error.statusCode = 403;
    throw error;
  }

  if (!["EMPLOYEE", "MANAGER"].includes(requested)) {
    const error = new Error("Role must be EMPLOYEE or MANAGER");
    error.statusCode = 400;
    throw error;
  }

  if (actorRole === "MANAGER" && requested !== "EMPLOYEE") {
    const error = new Error("Managers can only create employee accounts");
    error.statusCode = 403;
    throw error;
  }

  return requested;
};

module.exports = { generateTempPassword, resolveAssignableRole };
