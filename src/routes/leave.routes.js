const express = require("express");
const leaveController = require("../controllers/leave.controller");
const { authenticate, authorizeRoles } = require("../middleware/auth.middleware");

const router = express.Router();

router.use(authenticate);

// Leave Types & Balances
router.get("/types", leaveController.getLeaveTypes);
router.post(
  "/types",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN"),
  leaveController.createLeaveType
);
router.get("/balances", leaveController.getLeaveBalances);

// Leave Requests (Employee)
router.post("/apply", leaveController.createLeaveRequest);
router.post("/requests", leaveController.createLeaveRequest);
router.post("/request", leaveController.createLeaveRequest);
router.get("/requests/my", leaveController.getMyLeaveRequests);
router.get("/my", leaveController.getMyLeaveRequests);

// Leave Approvals (Manager / Admin)
router.get(
  "/requests",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  leaveController.getAllLeaveRequests
);
router.get(
  "/",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  leaveController.getAllLeaveRequests
);
router.put(
  "/requests/:id/review",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  leaveController.reviewLeaveRequest
);
router.put(
  "/:id/review",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  leaveController.reviewLeaveRequest
);

// Holidays
router.get("/holidays", leaveController.getHolidays);
router.post(
  "/holidays",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN"),
  leaveController.createHoliday
);

module.exports = router;
