const express = require("express");
const shiftOverrideController = require("../controllers/shiftoverride.controller");
const { authenticate, authorizeRoles } = require("../middleware/auth.middleware");

const router = express.Router();
router.use(authenticate);

// Admin/Manager sets a shift override for an employee on a specific date
router.post(
  "/",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  shiftOverrideController.setOverride
);

// Admin/Manager removes a shift override
router.delete(
  "/",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  shiftOverrideController.deleteOverride
);

// Admin/Manager views all org shift overrides
router.get(
  "/",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  shiftOverrideController.getOrganizationOverrides
);

// View personal shift overrides (Employee)
router.get("/my", shiftOverrideController.getEmployeeOverrides);

// View overrides for a specific employee
router.get(
  "/:employeeId",
  shiftOverrideController.getEmployeeOverrides
);

module.exports = router;
