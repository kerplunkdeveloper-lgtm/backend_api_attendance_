const express = require("express");
const authController = require("../controllers/auth.controller");
const { authenticate, authorizeRoles } = require("../middleware/auth.middleware");
const { authRateLimiter } = require("../middleware/rateLimiter.middleware");

const router = express.Router();

// Public Authentication Endpoints
router.get("/plans", authController.getPlans);
router.post("/register", authRateLimiter, authController.register);
router.post("/login", authRateLimiter, authController.login);
router.post("/refresh-token", authController.refreshToken);
router.post("/refresh", authController.refreshToken);
router.post("/logout", authController.logout);

// Protected Authentication Endpoints
router.get("/me", authenticate, authController.getMe);

// Plan unlock — admin enters the code from their registration email
router.post("/activate-plan", authenticate, authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN"), authController.activatePlan);

// Password change — works for all authenticated users (forced on first employee login)
router.post("/change-password", authenticate, authController.changePassword);


// RBAC Demonstration Endpoints
router.get(
  "/admin-only",
  authenticate,
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN"),
  (req, res) => {
    res.json({
      success: true,
      message: `Access granted to Admin-only resource. User role: ${req.user.role}.`,
      user: req.user,
    });
  }
);

router.get(
  "/manager-only",
  authenticate,
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  (req, res) => {
    res.json({
      success: true,
      message: `Access granted to Manager-level resource. User role: ${req.user.role}.`,
      user: req.user,
    });
  }
);

router.get("/employee-only", authenticate, (req, res) => {
  res.json({
    success: true,
    message: `Access granted to Employee resource. User role: ${req.user.role}.`,
    user: req.user,
  });
});

// Helpful browser fallbacks for GET requests
router.get("/register", (req, res) => {
  res.status(405).json({
    success: false,
    message: "Cannot GET /api/auth/register. Please send an HTTP POST request with a JSON body.",
    method: "POST",
    exampleBody: {
      email: "user@example.com",
      password: "Password123!",
      organizationName: "Acme Corp",
      firstName: "John",
      lastName: "Doe",
      subscriptionPlan: "PROFESSIONAL",                                   
      billingCycle: "MONTHLY" // MONTHLY, ANNUAL
    }
  });
});

router.get("/login", (req, res) => {
  res.status(405).json({
    success: false,
    message: "Cannot GET /api/auth/login. Please send an HTTP POST request with a JSON body.",
    method: "POST",
    exampleBody: {
      email: "user@example.com",
      password: "Password123!"
    }
  });
});

module.exports = router;