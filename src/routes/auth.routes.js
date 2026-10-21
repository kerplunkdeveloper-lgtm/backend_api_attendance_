const express = require("express");
const authController = require("../controllers/auth.controller");
const ssoController = require("../controllers/sso.controller");
const {
  authenticate,
  authorizeRoles,
} = require("../middleware/auth.middleware");
const {
  authRateLimiter,
  sessionRateLimiter,
  loginRateLimiter,
} = require("../middleware/rateLimiter.middleware");
const { validate, schemas } = require("../middleware/validate.middleware");
const { imageUploader, handleUploadErrors } = require("../middleware/upload.middleware");
const { protectCookieMutation } = require("../middleware/requestSecurity.middleware");

const router = express.Router();
const avatarUpload = imageUploader(6);
const avatarFields = avatarUpload.fields([
  { name: "image", maxCount: 1 },
  { name: "file", maxCount: 1 },
  { name: "avatar", maxCount: 1 },
]);

// Public Authentication Endpoints
router.get("/plans", authController.getPlans);
router.post(
  "/register",
  authRateLimiter,
  validate(schemas.register),
  authController.register,
);
router.post(
  "/login",
  loginRateLimiter,
  validate(schemas.login),
  authController.login,
);
router.post("/2fa/verify-login", authRateLimiter, validate(schemas.twoFactorLogin), authController.verifyTwoFactorLogin);
router.post(
  "/verify-email",
  authRateLimiter,
  validate(schemas.verifyEmail),
  authController.verifyEmail,
);
router.post(
  "/resend-verification",
  authRateLimiter,
  validate(schemas.resendVerification),
  authController.resendVerification,
);
router.post("/google", authRateLimiter, validate(schemas.googleLogin), authController.loginWithGoogle);
router.post("/sso/discover", authRateLimiter, validate(schemas.ssoDiscover), ssoController.discover);
router.get("/sso/start/:organizationId", authRateLimiter, ssoController.start);
router.get("/sso/callback", ssoController.callback);
router.post("/sso/exchange", authRateLimiter, validate(schemas.ssoExchange), ssoController.exchange);
router.post(
  "/refresh-token",
  sessionRateLimiter,
  validate(schemas.sessionMutation),
  protectCookieMutation,
  authController.refreshToken,
);
router.post(
  "/refresh",
  sessionRateLimiter,
  validate(schemas.sessionMutation),
  protectCookieMutation,
  authController.refreshToken,
);
router.post(
  "/logout",
  validate(schemas.sessionMutation),
  protectCookieMutation,
  authController.logout,
);
router.post(
  "/forgot-password",
  authRateLimiter,
  validate(schemas.forgotPassword),
  authController.forgotPassword,
);
router.post(
  "/reset-password",
  authRateLimiter,
  validate(schemas.resetPassword),
  authController.resetPassword,
);

// Protected Authentication Endpoints
router.get("/me", authenticate, authController.getMe);
router.put("/me", authenticate, authController.updateMe);
router.post(
  "/avatar",
  authenticate,
  avatarFields,
  handleUploadErrors,
  authController.uploadAvatar,
);

// Plan unlock — admin enters the code from their registration email
router.post(
  "/activate-plan",
  authenticate,
  authRateLimiter,
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN"),
  validate(schemas.activatePlan),
  authController.activatePlan,
);

// Platform-owner grant only. Company admins must use /billing/checkout.
router.post(
  "/upgrade-plan",
  authenticate,
  authorizeRoles("SUPER_ADMIN"),
  authController.upgradePlan,
);

// Password change — works for all authenticated users (forced on first employee login)
router.post(
  "/change-password",
  authenticate,
  validate(schemas.changePassword),
  authController.changePassword,
);
// Any signed-in person may protect their own account; workspaces can make it
// mandatory for company admins (Organization.requireAdminTwoFactor).
const humanOnly = (req, res, next) =>
  req.authType === "api_key"
    ? res.status(403).json({ success: false, message: "API keys cannot manage two-step verification." })
    : next();
router.post("/2fa/setup", authenticate, humanOnly, authController.beginTwoFactorSetup);
router.post("/2fa/confirm", authenticate, humanOnly, validate(schemas.twoFactorCode), authController.confirmTwoFactorSetup);
router.post("/2fa/disable", authenticate, humanOnly, validate(schemas.twoFactorCode), authController.disableTwoFactor);

module.exports = router;
