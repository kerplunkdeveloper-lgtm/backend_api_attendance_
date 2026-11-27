const express = require("express");
const employeeController = require("../controllers/employee.controller");
const employeeDocumentController = require("../controllers/employee-document.controller");
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
const avatarUpload = imageUploader();
const avatarFields = avatarUpload.fields([
  { name: "image", maxCount: 1 },
  { name: "file", maxCount: 1 },
  { name: "avatar", maxCount: 1 },
]);

router.use(authenticate);
// Keep the literal /me routes before any dynamic /:id route. Express matches
// /me as { id: "me" } otherwise, which sends profile requests to the avatar
// handler and returns a misleading 404.
router.get("/me", employeeController.getMe);
router.put("/me", employeeController.updateMe);
router.post(
  "/me/avatar",
  avatarFields,
  handleUploadErrors,
  employeeController.uploadMyAvatar,
);

router.get(
  "/:id/avatar-file",
  employeeController.getEmployeeAvatarFile
);

router.get(
  "/",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER", "HR"),
  employeeController.list,
);

// Preview the next company-wide employee code before the employee is saved.
router.get(
  "/next-code",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER", "HR"),
  employeeController.nextCode,
);

// Must stay above "/:id" or "celebrations" would be treated as an employee id.
router.get(
  "/celebrations",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER", "HR"),
  employeeController.celebrations,
);

router.get(
  "/export",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN"),
  employeeController.exportCsv,
);

// Must stay above "/:id" or the word "documents" is treated as an employee id.
router.get(
  "/documents/missing",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER", "HR"),
  employeeDocumentController.getMissingSummary,
);

router.get(
  "/documents/pending",
  authorizeRoles("COMPANY_ADMIN", "MANAGER", "HR"),
  employeeDocumentController.getPendingDocuments,
);

router.get(
  "/:id",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER", "HR"),
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
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER", "HR"),
  employeeController.update,
);

router.post(
  "/:id/avatar",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  avatarFields,
  handleUploadErrors,
  employeeController.uploadEmployeeAvatar,
);

// Bulk delete employees
router.post(
  "/bulk-delete",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN"),
  employeeController.bulkDelete,
);

// Delete employee
router.delete(
  "/:id",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN"),
  employeeController.remove,
);

const upload = documentUploader();

// Invite employee by email — auto-creates account + sends credentials via email
router.post(
  "/invite",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN"),
  employeeController.invite,
);

router.post(
  "/:id/resend-invite",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN"),
  employeeController.resendInvite,
);

// ─── Employee Documents Endpoints ──────────────────────────────────────────────

router.get("/:employeeId/documents", employeeDocumentController.getDocuments);
router.get("/:employeeId/documents/:documentId/content", employeeDocumentController.getDocumentContent);

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
  authorizeRoles("COMPANY_ADMIN", "MANAGER", "HR"),
  employeeDocumentController.verifyDocument,
);

// Trigger expiry reminder (Admin/Manager only)
router.post(
  "/:employeeId/documents/:documentId/remind-expiry",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER", "HR"),
  employeeDocumentController.sendExpiryReminder,
);

module.exports = router;
