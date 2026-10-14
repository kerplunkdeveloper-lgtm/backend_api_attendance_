function requireOwnerTwoFactor(req, res, next) {
  if (process.env.REQUIRE_OWNER_2FA === "false") return next();
  if (req.user?.role !== "SUPER_ADMIN" || req.user?.twoFactorEnabled) return next();
  return res.status(403).json({
    success: false,
    code: "TWO_FACTOR_REQUIRED",
    message: "Two-step verification is required for platform-owner actions.",
  });
}

module.exports = { requireOwnerTwoFactor };
