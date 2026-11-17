const express = require("express");
const biometricController = require("../controllers/biometric.controller");
const {
  authenticate,
  authorizeRoles,
  requireFeature,
} = require("../middleware/auth.middleware");

const router = express.Router();

router.post("/punch", biometricController.punch);

router.use(authenticate);
router.get(
  "/",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN"),
  requireFeature("hasApiAccess", "Biometric devices"),
  biometricController.list,
);
router.get(
  "/credentials",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN"),
  requireFeature("hasApiAccess", "Biometric cards"),
  biometricController.credentials,
);
router.post(
  "/credentials",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN"),
  requireFeature("hasApiAccess", "Biometric cards"),
  biometricController.assignCard,
);
router.delete(
  "/credentials/:id",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN"),
  requireFeature("hasApiAccess", "Biometric cards"),
  biometricController.removeCard,
);
router.post(
  "/",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN"),
  requireFeature("hasApiAccess", "Biometric devices"),
  biometricController.create,
);
router.delete(
  "/:id",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN"),
  requireFeature("hasApiAccess", "Biometric devices"),
  biometricController.revoke,
);

module.exports = router;
