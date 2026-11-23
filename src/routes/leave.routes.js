const express = require("express");
const leaveController = require("../controllers/leave.controller");
const {
  authenticate,
  authorizeRoles,
} = require("../middleware/auth.middleware");
const { validate, schemas } = require("../middleware/validate.middleware");

const router = express.Router();

router.use(authenticate);

// Leave Types & Balances
router.get("/types", leaveController.getLeaveTypes);
router.post(
  "/types",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "HR"),
  leaveController.createLeaveType,
);
router.put(
  "/types/:id",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "HR"),
  leaveController.updateLeaveType,
);
router.delete(
  "/types/:id",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "HR"),
  leaveController.deleteLeaveType,
);
router.post(
  "/carry-forward",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "HR"),
  leaveController.carryForward,
);
router.get("/balances", leaveController.getLeaveBalances);
router.get(
  "/balances/team",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER", "HR"),
  leaveController.getTeamLeaveBalances,
);
// Compatibility alias for older browser bundles that used the noun-first path.
// Keep the canonical route above for new clients.
router.get(
  "/team-balances",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER", "HR"),
  leaveController.getTeamLeaveBalances,
);
router.get("/conflicts", leaveController.getDepartmentConflicts);
router.get(
  "/employees/:employeeId/balances",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER", "HR"),
  leaveController.getEmployeeLeaveBalances,
);
router.get("/eligibility", leaveController.getEligibility);

// Leave Requests (Employee)
router.post(
  "/apply",
  validate(schemas.applyLeave),
  leaveController.createLeaveRequest,
);
router.post(
  "/requests",
  validate(schemas.applyLeave),
  leaveController.createLeaveRequest,
);
router.post(
  "/request",
  validate(schemas.applyLeave),
  leaveController.createLeaveRequest,
);
router.get("/requests/my", leaveController.getMyLeaveRequests);
router.get("/my", leaveController.getMyLeaveRequests);
// Mobile client compatibility alias.
router.get("/my-requests", leaveController.getMyLeaveRequests);
router.get("/date-changes/my", leaveController.getMyDateChanges);
router.post("/requests/:id/date-change", leaveController.requestDateChange);

// Withdraw / cancel. Ownership and timing rules are enforced in the service.
router.delete("/requests/:id", leaveController.cancelLeaveRequest);
router.post("/requests/:id/cancel", leaveController.cancelLeaveRequest);

// Leave Approvals (Manager / Admin)
router.get(
  "/requests",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER", "HR"),
  leaveController.getAllLeaveRequests,
);
router.get(
  "/",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER", "HR"),
  leaveController.getAllLeaveRequests,
);
router.get(
  "/date-changes",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER", "HR"),
  leaveController.getDateChanges,
);
router.put(
  "/requests/:id/review",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER", "HR"),
  validate(schemas.reviewRequest),
  leaveController.reviewLeaveRequest,
);
router.put(
  "/:id/review",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER", "HR"),
  validate(schemas.reviewRequest),
  leaveController.reviewLeaveRequest,
);
router.put(
  "/date-changes/:id/review",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER", "HR"),
  validate(schemas.reviewRequest),
  leaveController.reviewDateChange,
);

// Holidays
router.get("/holidays", leaveController.getHolidays);
router.post(
  "/holidays",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN"),
  leaveController.createHoliday,
);

module.exports = router;
