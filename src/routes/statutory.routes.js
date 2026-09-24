const express = require("express");
const statutoryController = require("../controllers/statutory.controller");
const { authenticate, authorizeRoles } = require("../middleware/auth.middleware");

const router = express.Router();
router.use(authenticate);

router.get("/it-declaration", statutoryController.getDeclaration);
router.put("/it-declaration", statutoryController.saveDeclaration);
router.get("/tds-preview", statutoryController.previewTax);
router.get("/form-16", statutoryController.downloadForm16);
router.post(
  "/form-16/generate",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  statutoryController.generateForm16
);
router.get(
  "/exports",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  statutoryController.listExports
);
router.get(
  "/exports/:id/download",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  statutoryController.downloadSavedExport
);
router.get(
  "/exports/pf-ecr",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  statutoryController.exportPf
);
router.get(
  "/exports/esi",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  statutoryController.exportEsi
);
router.get(
  "/exports/neft",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  statutoryController.exportNeft
);

module.exports = router;
