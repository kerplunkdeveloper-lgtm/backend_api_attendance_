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
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN"),
  leaveController.createLeaveType,
);
router.put(
  "/types/:id",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN"),
  leaveController.updateLeaveType,
);
router.delete(
  "/types/:id",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN"),
  leaveController.deleteLeaveType,
);
router.post(
  "/carry-forward",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN"),
  leaveController.carryForward,
);
router.get("/balances", leaveController.getLeaveBalances);

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

// Withdraw / cancel. Ownership and timing rules are enforced in the service.
router.delete("/requests/:id", leaveController.cancelLeaveRequest);
router.post("/requests/:id/cancel", leaveController.cancelLeaveRequest);

// Leave Approvals (Manager / Admin)
router.get(
  "/requests",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  leaveController.getAllLeaveRequests,
);
router.get(
  "/",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  leaveController.getAllLeaveRequests,
);
router.put(
  "/requests/:id/review",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  validate(schemas.reviewRequest),
  leaveController.reviewLeaveRequest,
);
router.put(
  "/:id/review",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  validate(schemas.reviewRequest),
  leaveController.reviewLeaveRequest,
);

// Holidays
router.get("/holidays", leaveController.getHolidays);
router.post(
  "/holidays",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN"),
  leaveController.createHoliday,
);

module.exports = router;
