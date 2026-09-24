const express = require("express");
const authController = require("../controllers/auth.controller");
const {
  authenticate,
  authorizeRoles,
} = require("../middleware/auth.middleware");
const { authRateLimiter } = require("../middleware/rateLimiter.middleware");
const { validate, schemas } = require("../middleware/validate.middleware");

const router = express.Router();

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
  authRateLimiter,
  validate(schemas.login),
  authController.login,
);
router.post("/google", authRateLimiter, authController.loginWithGoogle);
router.post("/refresh-token", authRateLimiter, authController.refreshToken);
router.post("/refresh", authRateLimiter, authController.refreshToken);
router.post("/logout", authController.logout);
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

// Plan unlock — admin enters the code from their registration email
router.post(
  "/activate-plan",
  authenticate,
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN"),
  validate(schemas.activatePlan),
  authController.activatePlan,
);

// Plan upgrade / change tier
router.post(
  "/upgrade-plan",
  authenticate,
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN"),
  authController.upgradePlan,
);

// Password change — works for all authenticated users (forced on first employee login)
router.post(
  "/change-password",
  authenticate,
  validate(schemas.changePassword),
  authController.changePassword,
);

module.exports = router;
