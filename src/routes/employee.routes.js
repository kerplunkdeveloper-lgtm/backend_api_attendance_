const express = require("express");
const employeeController = require("../controllers/employee.controller");
const {
  authenticate,
  authorizeRoles,
} = require("../middleware/auth.middleware");

const router = express.Router();

router.use(authenticate);

router.get("/me", employeeController.getMe);
router.put("/me", employeeController.updateMe);

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

// Delete employee
router.delete(
  "/:id",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN"),
  employeeController.remove,
);

const multer = require("multer");
const employeeDocumentController = require("../controllers/employee-document.controller");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024, // 15MB limit
  },
});

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
  employeeDocumentController.uploadDocument,
);

// Replace or edit document metadata
router.put(
  "/:employeeId/documents/:documentId",
  upload.single("file"),
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
