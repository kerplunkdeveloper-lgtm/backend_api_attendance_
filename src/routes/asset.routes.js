const express = require("express");
const assetController = require("../controllers/asset.controller");
const {
  authenticate,
  authorizeRoles,
} = require("../middleware/auth.middleware");

const router = express.Router();

router.use(authenticate);

// 1. Employee self-service: View assigned assets & custody history
router.get("/my-assets", assetController.getMyAssets);

// 2. Admin/HR: View assets assigned to a specific employee
router.get(
  "/employee/:employeeId",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  assetController.getEmployeeAssets,
);

// 3. List all assets with search, filters & overview metrics
router.get(
  "/",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  assetController.getAssets,
);

// 4. Create new asset
router.post(
  "/",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN"),
  assetController.createAsset,
);

// 5. Get single asset details with lifecycle logs
router.get("/:id", assetController.getAssetById);

// 6. Update asset
router.put(
  "/:id",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN"),
  assetController.updateAsset,
);

// 7. Delete asset
router.delete(
  "/:id",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN"),
  assetController.deleteAsset,
);

// 8. Assign asset to employee
router.post(
  "/:id/assign",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  assetController.assignAsset,
);

// 9. Return asset to inventory
router.post(
  "/:id/return",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  assetController.returnAsset,
);

// 10. Transfer asset to another employee
router.post(
  "/:id/transfer",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  assetController.transferAsset,
);

// 11. Log maintenance
router.post(
  "/:id/maintenance",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN"),
  assetController.logMaintenance,
);

// 12. Complete maintenance
router.put(
  "/:id/maintenance/:maintenanceId/complete",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN"),
  assetController.completeMaintenance,
);

module.exports = router;
