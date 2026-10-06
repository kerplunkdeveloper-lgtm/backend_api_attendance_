const express = require("express");
const employeeController = require("../controllers/employee.controller");
const {
  authenticate,
  authorizeRoles,
} = require("../middleware/auth.middleware");
const {
  documentUploader,
  imageUploader,
  handleUploadErrors,
} = require("../middleware/upload.middleware");

const router = express.Router();
const avatarUpload = imageUploader(6);
const avatarFields = avatarUpload.fields([
  { name: "image", maxCount: 1 },
  { name: "file", maxCount: 1 },
  { name: "avatar", maxCount: 1 },
]);

router.use(authenticate);

router.get("/me", employeeController.getMe);
router.put("/me", employeeController.updateMe);
router.post(
  "/me/avatar",
  avatarFields,
  handleUploadErrors,
  employeeController.uploadMyAvatar,
);

router.get(
  "/",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  employeeController.list,
);

router.get(
  "/:id",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  employeeController.getById,
);

// Create employee
// Bulk import employees from Excel / CSV
router.post(
  "/bulk-import",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  employeeController.bulkImport,
);

// Deactivate / reactivate several employees' logins at once
router.post(
  "/bulk-access",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN"),
  employeeController.bulkSetAccess,
);

router.post(
  "/",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  employeeController.create,
);

// Update employee
router.put(
  "/:id",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  employeeController.update,
);

router.post(
  "/:id/avatar",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  avatarFields,
  handleUploadErrors,
  employeeController.uploadEmployeeAvatar,
);

// Delete employee
router.delete(
  "/:id",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN"),
  employeeController.remove,
);

const employeeDocumentController = require("../controllers/employee-document.controller");

const upload = documentUploader(15);

// Invite employee by email — auto-creates account + sends credentials via email
router.post(
  "/invite",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN"),
  employeeController.invite,
);

// ─── Employee Documents Endpoints ──────────────────────────────────────────────

router.get("/:employeeId/documents", employeeDocumentController.getDocuments);

// Upload document
router.post(
  "/:employeeId/documents",
  upload.single("file"),
  handleUploadErrors,
  employeeDocumentController.uploadDocument,
);

// Replace or edit document metadata
router.put(
  "/:employeeId/documents/:documentId",
  upload.single("file"),
  handleUploadErrors,
  employeeDocumentController.replaceOrUpdateDocument,
);

// Delete document
router.delete(
  "/:employeeId/documents/:documentId",
  employeeDocumentController.deleteDocument,
);

// Verify or reject document (Admin/Manager only)
router.post(
  "/:employeeId/documents/:documentId/verify",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  employeeDocumentController.verifyDocument,
);

// Trigger expiry reminder (Admin/Manager only)
router.post(
  "/:employeeId/documents/:documentId/remind-expiry",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  employeeDocumentController.sendExpiryReminder,
);

module.exports = router;
