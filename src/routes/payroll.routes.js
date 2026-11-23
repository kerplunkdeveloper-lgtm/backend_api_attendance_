const express = require("express");
const multer = require("multer");
const payrollController = require("../controllers/payroll.controller");
const statutoryRoutes = require("./statutory.routes");
const payslipTemplateController = require("../controllers/payslip-template.controller");
const {
  authenticate,
  authorizeRoles,
  requireFeature,
} = require("../middleware/auth.middleware");
const { UPLOAD_POLICY } = require("../config/upload-policy");
const { assertRealImage } = require("../middleware/upload.middleware");

const assetUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: UPLOAD_POLICY.templateAsset.maxBytes, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!UPLOAD_POLICY.templateAsset.allowed.includes(file.mimetype)) {
      const error = new Error("Only JPG, PNG or WEBP images are allowed for payroll branding.");
      error.statusCode = 415;
      return cb(error);
    }
    cb(null, true);
  },
});

const htmlUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: UPLOAD_POLICY.htmlTemplate.maxBytes, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!UPLOAD_POLICY.htmlTemplate.allowed.includes(file.mimetype)) {
      const error = new Error("Only HTML template files are allowed.");
      error.statusCode = 415;
      return cb(error);
    }
    cb(null, true);
  },
});

const router = express.Router();

router.use(authenticate);
router.use(requireFeature("hasPayroll", "Payroll"));

// Statutory payroll endpoints are exposed under /payroll because the web client uses that API namespace.
router.use(statutoryRoutes);

// Personal Payslips for logged-in employee
router.get("/payslips/my", payrollController.getMyPayslips);
router.get("/my-payslips", payrollController.getMyPayslips);
// Employee self-service request for a missing payslip; notifies HR/payroll admins.
router.post("/payslip-requests", payrollController.requestPayslip);

// Salary Structure Configuration (Company Admin & Manager)
router.post(
  "/salary-structure",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER", "HR"),
  payrollController.upsertSalaryStructure,
);
router.get(
  "/cycle",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER", "HR"),
  payrollController.getPayrollCycle,
);

router.post(
  "/salary-structure/bulk",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER", "HR"),
  payrollController.bulkUpsertSalaryStructures,
);
router.get(
  "/salary-structure/:employeeId",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER", "HR"),
  payrollController.getSalaryStructure,
);

// Live Attendance-Driven Payroll Calculator Preview
router.get(
  "/calculate",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER", "HR"),
  payrollController.calculate,
);

// Generate Monthly Payslips for Organization
router.post(
  "/generate",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "HR"),
  payrollController.generate,
);

// List Organization Payslips
router.get(
  "/payslips",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER", "HR"),
  payrollController.getPayslips,
);

// Detailed Payslip View with Company Letterhead & Amount in Words for PDF
router.get("/payslips/:id/details", payrollController.getPayslipDetails);
// Direct PDF Download route for Employee and Admin
router.get("/payslips/:id/pdf", payrollController.getPayslipPdf);
// Mobile client compatibility: GET /payslips/:id (without /details).
router.get("/payslips/:id", payrollController.getPayslipDetails);

// Individual Payslip Status Update
router.patch(
  "/payslips/:id/status",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "HR"),
  payrollController.updateStatus,
);

// Distribute one approved payslip and notify only that employee.
router.post(
  "/payslips/:id/disburse",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "HR"),
  payrollController.disburseIndividual,
);

// Payroll Approval Workflow: Batch Approve
router.post(
  "/approve-batch",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "HR"),
  payrollController.approveBatch,
);

// Payroll Approval Workflow: Batch Disburse
router.post(
  "/disburse-batch",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "HR"),
  payrollController.disburseBatch,
);

// Payroll Analytics & Compliance Reports
router.get(
  "/reports",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER", "HR"),
  payrollController.getReports,
);

// Employee Salary History & Audit Trail
router.get(
  "/salary-history/:employeeId",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER", "HR"),
  payrollController.getSalaryHistory,
);

// Record New Salary Revision
router.post(
  "/salary-revision",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER", "HR"),
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
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER", "HR"),
  payslipTemplateController.saveTemplate,
);

// Reset company template to system preset
router.post(
  "/templates/reset",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER", "HR"),
  payslipTemplateController.resetPreset,
);

// Upload Logo or Authorized Signature Stamp image
router.post(
  "/templates/upload-asset",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER", "HR"),
  assetUpload.single("file"),
  (req, res, next) => {
    try { if (req.file) assertRealImage(req.file); next(); } catch (error) { next(error); }
  },
  payslipTemplateController.uploadAsset,
);

// Upload Custom HTML Payslip Template file
router.post(
  "/templates/upload-html",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  htmlUpload.single("file"),
  payslipTemplateController.uploadHtmlTemplate,
);

router.use((err, req, res, next) => {
  if (err?.code === "LIMIT_FILE_SIZE") return res.status(413).json({ success: false, message: "Uploaded file is too large." });
  if (err?.statusCode === 415) return res.status(415).json({ success: false, message: err.message });
  next(err);
});

module.exports = router;
