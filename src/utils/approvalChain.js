const ADMIN_ROLES = ["SUPER_ADMIN", "COMPANY_ADMIN"];

/**
 * Two-level approval chain:
 *  - requests from EMPLOYEE accounts are reviewed by HR (MANAGER) or an admin
 *  - requests from HR (MANAGER) or admin accounts are reviewed by an admin only
 */
const requiresAdminReview = (requesterRole) => requesterRole !== undefined && requesterRole !== null && requesterRole !== "EMPLOYEE";

const assertCanReview = (requesterRole, reviewerRole) => {
  if (requiresAdminReview(requesterRole) && !ADMIN_ROLES.includes(reviewerRole)) {
    const error = new Error("Requests raised by HR or admin accounts must be approved by an admin.");
    error.statusCode = 403;
    throw error;
  }
};

/** Prisma filter hiding admin-only requests from reviewers who may not action them. */
const visibleToReviewer = (reviewerRole) =>
  ADMIN_ROLES.includes(reviewerRole) ? {} : { employee: { user: { is: { role: "EMPLOYEE" } } } };

module.exports = { ADMIN_ROLES, requiresAdminReview, assertCanReview, visibleToReviewer };
