const express = require("express");
const payrollController = require("../controllers/payroll.controller");
const { authenticate, authorizeRoles } = require("../middleware/auth.middleware");

const router = express.Router();

router.use(authenticate);

// Personal Payslips for logged-in employee
router.get("/payslips/my", payrollController.getMyPayslips);
router.get("/my-payslips", payrollController.getMyPayslips);

// Salary Structure Configuration (Company Admin & Manager)
router.post(
  "/salary-structure",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  payrollController.upsertSalaryStructure
);
router.get(
  "/salary-structure/:employeeId",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  payrollController.getSalaryStructure
);

// Live Attendance-Driven Payroll Calculator Preview
router.get(
  "/calculate",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  payrollController.calculate
);

// Generate Monthly Payslips for Organization
router.post(
  "/generate",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN"),
  payrollController.generate
);

// List Organization Payslips
router.get(
  "/payslips",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  payrollController.getPayslips
);

// Detailed Payslip View with Company Letterhead & Amount in Words for PDF
router.get(
  "/payslips/:id/details",
  payrollController.getPayslipDetails
);

// Individual Payslip Status Update
router.patch(
  "/payslips/:id/status",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  payrollController.updateStatus
);

// Payroll Approval Workflow: Batch Approve
router.post(
  "/approve-batch",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  payrollController.approveBatch
);

// Payroll Approval Workflow: Batch Disburse
router.post(
  "/disburse-batch",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN"),
  payrollController.disburseBatch
);

// Payroll Analytics & Compliance Reports
router.get(
  "/reports",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  payrollController.getReports
);

// Employee Salary History & Audit Trail
router.get(
  "/salary-history/:employeeId",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  payrollController.getSalaryHistory
);

// Record New Salary Revision
router.post(
  "/salary-revision",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  payrollController.recordSalaryRevision
);

module.exports = router;
