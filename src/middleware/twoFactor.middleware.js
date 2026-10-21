function requireOwnerTwoFactor(req, res, next) {
  if (process.env.REQUIRE_OWNER_2FA === "false") return next();
  if (req.user?.role !== "SUPER_ADMIN" || req.user?.twoFactorEnabled) return next();
  return res.status(403).json({
    success: false,
    code: "TWO_FACTOR_REQUIRED",
    message: "Two-step verification is required for platform-owner actions.",
  });
}

// Sign-in, session and 2FA setup endpoints stay reachable so an admin who is
// blocked by the workspace policy can still turn two-step verification on.
const policyExemptPathRe = /^\/(api\/)?(v1\/)?auth\/(me|logout|refresh|refresh-token|2fa)(\/|$)/;

/**
 * Workspace policy: when Organization.requireAdminTwoFactor is on, a company
 * admin without two-step verification gets 403 TWO_FACTOR_REQUIRED everywhere
 * except the exempt paths above. Returns the response it sent, or null.
 */
function denyIfTenantTwoFactorMissing(req, res) {
  const user = req.user;
  if (!user || user.role !== "COMPANY_ADMIN" || user.twoFactorEnabled) return null;
  if (!user.organization?.requireAdminTwoFactor) return null;
  const path = String(req.originalUrl || req.path || "").split("?")[0];
  if (policyExemptPathRe.test(path)) return null;
  return res.status(403).json({
    success: false,
    code: "TWO_FACTOR_REQUIRED",
    message: "Your workspace requires admins to turn on two-step verification. Set it up to continue.",
  });
}

module.exports = { requireOwnerTwoFactor, denyIfTenantTwoFactorMissing };
