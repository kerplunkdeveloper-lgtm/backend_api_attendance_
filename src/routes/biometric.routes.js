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
