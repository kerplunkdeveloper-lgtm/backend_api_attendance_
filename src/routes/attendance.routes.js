const express = require("express");
const attendanceController = require("../controllers/attendance.controller");
const {
  authenticate,
  authorizeRoles,
  denyCompanyAdminSelfPunch,
} = require("../middleware/auth.middleware");
const { validate, schemas } = require("../middleware/validate.middleware");

const router = express.Router();

// Require valid JWT authentication for all attendance endpoints
router.use(authenticate);

// ── Employee Self-Service Punch Station ───────────────────────────────────────
// Standard GPS check-in (geofence enforced)
router.post(
  "/check-in",
  denyCompanyAdminSelfPunch,
  validate(schemas.checkIn),
  attendanceController.checkIn,
);

// WFH check-in (no geofence required — sets WORK_FROM_HOME status)
router.post(
  "/check-in-wfh",
  denyCompanyAdminSelfPunch,
  validate(schemas.checkIn),
  attendanceController.wfhCheckIn,
);
router.post(
  "/wfh-check-in",
  denyCompanyAdminSelfPunch,
  validate(schemas.checkIn),
  attendanceController.wfhCheckIn,
);

// Check-out
router.post(
  "/check-out",
  denyCompanyAdminSelfPunch,
  validate(schemas.checkIn),
  attendanceController.checkOut,
);

// Break management
router.post("/break-start", denyCompanyAdminSelfPunch, attendanceController.startBreak);
router.post("/break-end", denyCompanyAdminSelfPunch, attendanceController.endBreak);
router.post("/lunch-start", denyCompanyAdminSelfPunch, attendanceController.startLunch);
router.post("/lunch-end", denyCompanyAdminSelfPunch, attendanceController.endLunch);

// Offline sync — batch sync locally-queued punches when internet is restored
router.post("/sync-offline", denyCompanyAdminSelfPunch, attendanceController.syncOfflinePunches);

// Break detail (structured break pairs)
router.get("/breaks", attendanceController.getBreakDetails);
router.get("/:attendanceId/breaks", attendanceController.getBreakDetails);

// Today's active session status
router.get("/today", attendanceController.getTodayStatus);

// Where everyone punched today. Locations are for admins and HR only.
router.get("/live-today", authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"), attendanceController.getLiveToday);

// Personal attendance history
router.get("/my", attendanceController.getMyAttendance);
router.get("/history", attendanceController.getAttendanceHistory);

// ── Admin / Manager Operations ─────────────────────────────────────────────────

// Today's org KPI summary
router.get(
  "/summary",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  attendanceController.getAttendanceSummary,
);

// Today's attendance for each branch (present / total, leave, off, absent)
router.get(
  "/branch-summary",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER", "HR"),
  attendanceController.getBranchSummary,
);

// All org attendance logs (filterable)
router.get(
  "/",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER", "HR"),
  attendanceController.getAllAttendance,
);
router.get(
  "/all",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER", "HR"),
  attendanceController.getAllAttendance,
);

// Admin direct mark (bypass GPS/correction flow)
router.post(
  "/admin-mark",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  attendanceController.adminMarkAttendance,
);

// Manual EOD absent marking (on-demand trigger)
router.post(
  "/mark-absent",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN"),
  attendanceController.markAbsent,
);

module.exports = router;
