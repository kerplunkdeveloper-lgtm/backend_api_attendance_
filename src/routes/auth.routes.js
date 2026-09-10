const express = require("express");
const authController = require("../controllers/auth.controller");
const { authenticate, authorizeRoles } = require("../middleware/auth.middleware");

const router = express.Router();

// Public Authentication Endpoints
router.post("/register", authController.register);
router.post("/login", authController.login);
router.post("/refresh-token", authController.refreshToken);
router.post("/refresh", authController.refreshToken);
router.post("/logout", authController.logout);

// Protected Authentication Endpoints
router.get("/me", authenticate, authController.getMe);

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
      organizationName: "Optional Org Name",
      firstName: "John",
      lastName: "Doe"
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