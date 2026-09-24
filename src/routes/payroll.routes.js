const express = require("express");
const multer = require("multer");
const payrollController = require("../controllers/payroll.controller");
const payslipTemplateController = require("../controllers/payslip-template.controller");
const {
  authenticate,
  authorizeRoles,
} = require("../middleware/auth.middleware");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB limit for logos, signatures, or templates
});

const router = express.Router();

router.use(authenticate);

// Personal Payslips for logged-in employee
router.get("/payslips/my", payrollController.getMyPayslips);
router.get("/my-payslips", payrollController.getMyPayslips);
// Employee self-service request for a missing payslip; notifies HR/payroll admins.
router.post("/payslip-requests", payrollController.requestPayslip);

// Salary Structure Configuration (Company Admin & Manager)
router.post(
  "/salary-structure",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  payrollController.upsertSalaryStructure,
);
router.get(
  "/salary-structure/:employeeId",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  payrollController.getSalaryStructure,
);

// Live Attendance-Driven Payroll Calculator Preview
router.get(
  "/calculate",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  payrollController.calculate,
);

// Generate Monthly Payslips for Organization
router.post(
  "/generate",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN"),
  payrollController.generate,
);

// List Organization Payslips
router.get(
  "/payslips",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  payrollController.getPayslips,
);

// Detailed Payslip View with Company Letterhead & Amount in Words for PDF
router.get("/payslips/:id/details", payrollController.getPayslipDetails);
// Mobile client compatibility: GET /payslips/:id (without /details).
router.get("/payslips/:id", payrollController.getPayslipDetails);

// Individual Payslip Status Update
router.patch(
  "/payslips/:id/status",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  payrollController.updateStatus,
);

// Payroll Approval Workflow: Batch Approve
router.post(
  "/approve-batch",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  payrollController.approveBatch,
);

// Payroll Approval Workflow: Batch Disburse
router.post(
  "/disburse-batch",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN"),
  payrollController.disburseBatch,
);

// Payroll Analytics & Compliance Reports
router.get(
  "/reports",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  payrollController.getReports,
);

// Employee Salary History & Audit Trail
router.get(
  "/salary-history/:employeeId",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  payrollController.getSalaryHistory,
);

// Record New Salary Revision
router.post(
  "/salary-revision",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  payrollController.recordSalaryRevision,
);

// ── Payslip Template Customizer & Uploader Endpoints ─────────────────────
// List presets
router.get("/templates/presets", payslipTemplateController.getPresets);

// Get company active template
router.get("/templates", payslipTemplateController.getTemplate);

// Save / customize company template
router.post(
  "/templates",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  payslipTemplateController.saveTemplate,
);

// Reset company template to system preset
router.post(
  "/templates/reset",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  payslipTemplateController.resetPreset,
);

// Upload Logo or Authorized Signature Stamp image
router.post(
  "/templates/upload-asset",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  upload.single("file"),
  payslipTemplateController.uploadAsset,
);

// Upload Custom HTML Payslip Template file
router.post(
  "/templates/upload-html",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  upload.single("file"),
  payslipTemplateController.uploadHtmlTemplate,
);

module.exports = router;
