const express = require("express");
const attendanceController = require("../controllers/attendance.controller");
const { authenticate, authorizeRoles } = require("../middleware/auth.middleware");

const router = express.Router();

// Require valid JWT authentication for all attendance endpoints
router.use(authenticate);

// ── Employee Self-Service Punch Station ───────────────────────────────────────
// Standard GPS check-in (geofence enforced)
router.post("/check-in", attendanceController.checkIn);

// WFH check-in (no geofence required — sets WORK_FROM_HOME status)
router.post("/check-in-wfh", attendanceController.wfhCheckIn);

// Check-out
router.post("/check-out", attendanceController.checkOut);

// Break management
router.post("/break-start", attendanceController.startBreak);
router.post("/break-end", attendanceController.endBreak);

// Offline sync — batch sync locally-queued punches when internet is restored
router.post("/sync-offline", attendanceController.syncOfflinePunches);

// Break detail (structured break pairs)
router.get("/breaks", attendanceController.getBreakDetails);
router.get("/:attendanceId/breaks", attendanceController.getBreakDetails);

// Today's active session status
router.get("/today", attendanceController.getTodayStatus);

// Personal attendance history
router.get("/my", attendanceController.getMyAttendance);
router.get("/history", attendanceController.getAttendanceHistory);

// ── Admin / Manager Operations ─────────────────────────────────────────────────

// Today's org KPI summary
router.get(
  "/summary",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  attendanceController.getAttendanceSummary
);

// All org attendance logs (filterable)
router.get(
  "/",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  attendanceController.getAllAttendance
);

// Admin direct mark (bypass GPS/correction flow)
router.post(
  "/admin-mark",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  attendanceController.adminMarkAttendance
);

// Manual EOD absent marking (on-demand trigger)
router.post(
  "/mark-absent",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN"),
  attendanceController.markAbsent
);

module.exports = router;
