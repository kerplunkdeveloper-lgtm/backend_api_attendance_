const express = require("express");
const attendanceController = require("../controllers/attendance.controller");
const { authenticate, authorizeRoles } = require("../middleware/auth.middleware");

const router = express.Router();

// Require valid JWT authentication for all attendance endpoints
router.use(authenticate);

// Personal Punch Station actions (Accessible to all authenticated staff)
router.post("/check-in", attendanceController.checkIn);
router.post("/check-out", attendanceController.checkOut);
router.post("/break-start", attendanceController.startBreak);
router.post("/break-end", attendanceController.endBreak);
router.get("/today", attendanceController.getTodayStatus);
router.get("/my", attendanceController.getMyAttendance);
router.get("/history", attendanceController.getAttendanceHistory);

// Organization-wide Attendance Logs & Analytics (Managers and Admins)
router.get(
  "/summary",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  attendanceController.getAttendanceSummary
);

router.get(
  "/",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  attendanceController.getAllAttendance
);

module.exports = router;
