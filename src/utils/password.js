const crypto = require("crypto");

/** One-time login password. Never reuse a static default. */
const generateTempPassword = () =>
  `TMP-${crypto.randomBytes(3).toString("hex").toUpperCase()}${crypto.randomInt(1000, 9999)}`;

/**
 * Roles an actor may assign when creating or updating a user through employee APIs.
 * SUPER_ADMIN and COMPANY_ADMIN are never accepted from a request body —
 * tenant administrators must not be able to grant platform-owner privileges.
 */
const resolveAssignableRole = (requestedRole, actorRole = "COMPANY_ADMIN") => {
  const requested = requestedRole === "HR" ? "MANAGER" : requestedRole || "EMPLOYEE";

  if (requested === "SUPER_ADMIN" || requested === "COMPANY_ADMIN") {
    const error = new Error("This role cannot be assigned through employee APIs");
    error.statusCode = 403;
    throw error;
  }

  if (!["EMPLOYEE", "MANAGER"].includes(requested)) {
    const error = new Error("Role must be EMPLOYEE or MANAGER");
    error.statusCode = 400;
    throw error;
  }

  if (actorRole === "MANAGER" && requested !== "EMPLOYEE") {
    const error = new Error("Managers can only assign the employee role");
    error.statusCode = 403;
    throw error;
  }

  return requested;
};

const PRIVILEGED_TARGETS = new Set(["SUPER_ADMIN", "COMPANY_ADMIN"]);

/**
 * Validates a role change on an existing employee. Blocks self-promotion,
 * modification of privileged accounts, and any grant outside resolveAssignableRole.
 */
const assertRoleAssignment = ({
  requestedRole,
  actorRole = "COMPANY_ADMIN",
  actorUserId,
  targetUserId,
  targetRole,
}) => {
  if (actorUserId && targetUserId && actorUserId === targetUserId) {
    const error = new Error("You cannot change your own role");
    error.statusCode = 403;
    throw error;
  }

  if (targetRole && PRIVILEGED_TARGETS.has(targetRole) && actorRole !== "SUPER_ADMIN") {
    const error = new Error("This account cannot be reassigned");
    error.statusCode = 403;
    throw error;
  }

  if (actorRole === "MANAGER" && targetRole && targetRole !== "EMPLOYEE") {
    const error = new Error("Managers can only update employee accounts");
    error.statusCode = 403;
    throw error;
  }

  return resolveAssignableRole(requestedRole, actorRole);
};

module.exports = { generateTempPassword, resolveAssignableRole, assertRoleAssignment };
