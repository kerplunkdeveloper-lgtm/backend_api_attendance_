const express = require("express");
const biometricController = require("../controllers/biometric.controller");
const {
  authenticate,
  authorizeRoles,
} = require("../middleware/auth.middleware");

const router = express.Router();

router.post("/punch", biometricController.punch);

router.use(authenticate);
router.get(
  "/",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN"),
  biometricController.list,
);
router.post(
  "/",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN"),
  biometricController.create,
);
router.delete(
  "/:id",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN"),
  biometricController.revoke,
);

module.exports = router;
