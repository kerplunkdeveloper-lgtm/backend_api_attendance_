const attendanceService = require("../services/attendance.service");
const { ok, paginated, fail } = require("../utils/response");

class AttendanceController {
  /**
   * Clock in with GPS coordinates and shift policy check
   */
  async checkIn(req, res) {
    try {
      const {
        latitude,
        longitude,
        accuracy,
        timestamp,
        employeeId,
        workMode,
        note,
        deviceId,
      } = req.body;
      const organizationId = req.user.organizationId;
      const userId = req.user.id;

      const result = await attendanceService.checkIn({
        userId,
        employeeId: employeeId || req.user.employee?.id,
        organizationId,
        latitude,
        longitude,
        accuracy,
        timestamp,
        workMode,
        note,
        actorRole: req.user.role,
        deviceId: deviceId || req.headers["x-device-id"],
      });

      return res.status(201).json(result);
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        message: error.message,
        details: error.details,
      });
    }
  }

  /**
   * Clock out with working hours and overtime calculation
   */
  async checkOut(req, res) {
    try {
      const {
        latitude,
        longitude,
        accuracy,
        timestamp,
        employeeId,
        workMode,
        note,
        deviceId,
      } = req.body;
      const organizationId = req.user.organizationId;
      const userId = req.user.id;

      const result = await attendanceService.checkOut({
        userId,
        employeeId: employeeId || req.user.employee?.id,
        organizationId,
        latitude,
        longitude,
        accuracy,
        timestamp,
        workMode,
        note,
        actorRole: req.user.role,
        deviceId: deviceId || req.headers["x-device-id"],
      });

      return res.status(200).json(result);
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        message: error.message,
      });
    }
  }

  /**
   * Start Break
   */
  async startBreak(req, res) {
    try {
      const { latitude, longitude, timestamp } = req.body;
      const result = await attendanceService.startBreak({
        userId: req.user.id,
        employeeId: req.user.employee?.id,
        organizationId: req.user.organizationId,
        latitude,
        longitude,
        timestamp,
      });
      return res.status(200).json(result);
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        message: error.message,
      });
    }
  }

  /**
   * End Break
   */
  async endBreak(req, res) {
    try {
      const { latitude, longitude, timestamp } = req.body;
      const result = await attendanceService.endBreak({
        userId: req.user.id,
        employeeId: req.user.employee?.id,
        organizationId: req.user.organizationId,
        latitude,
        longitude,
        timestamp,
      });
      return res.status(200).json(result);
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        message: error.message,
      });
    }
  }

  /**
   * Get active punch status for current user today
   */
  async getTodayStatus(req, res) {
    try {
      const result = await attendanceService.getTodayStatus(
        req.user.id,
        req.user.organizationId,
      );
      return res.status(200).json(result);
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  /**
   * Get personal attendance history for logged-in employee
   */
  async getMyAttendance(req, res) {
    try {
      const result = await attendanceService.getMyAttendance(
        req.user.id,
        req.user.organizationId,
        req.query,
      );
      return paginated(res, result);
    } catch (error) {
      return fail(res, error);
    }
  }

  /**
   * Get all organization attendance logs (Admins & Managers)
   */
  async getAllAttendance(req, res) {
    try {
      const result = await attendanceService.getAllAttendance(
        req.user.organizationId,
        req.query,
      );
      return paginated(res, result);
    } catch (error) {
      return fail(res, error);
    }
  }

  /**
   * Get today's attendance summary metrics
   */
  async getAttendanceSummary(req, res) {
    try {
      const result = await attendanceService.getAttendanceSummary(
        req.user.organizationId,
        req.query.date,
        req.query.branchId,
      );
      // Spread first so the summary's own fields stay at the top level for
      // existing readers, then expose the canonical `success`/`data` envelope.
      return res.status(200).json({ ...result, success: true, data: result });
    } catch (error) {
      return fail(res, error);
    }
  }

  /**
   * Get attendance history with filters (page, limit, from, to, status, employeeId)
   */
  async getAttendanceHistory(req, res) {
    try {
      const result = await attendanceService.getAttendanceHistory({
        userId: req.user.id,
        organizationId: req.user.organizationId,
        role: req.user.role,
        employeeId: req.query.employeeId,
        from: req.query.from,
        to: req.query.to,
        status: req.query.status,
        page: req.query.page,
        limit: req.query.limit,
      });
      return paginated(res, result);
    } catch (error) {
      return fail(res, error);
    }
  }

  /**
   * WFH Check-In (skips geofence, marks WORK_FROM_HOME)
   */
  async wfhCheckIn(req, res) {
    try {
      // Mobile sends `note`; web sends `wfhNote`.
      const { timestamp, wfhNote, note, deviceId } = req.body;
      const result = await attendanceService.wfhCheckIn({
        userId: req.user.id,
        employeeId: req.user.employee?.id,
        organizationId: req.user.organizationId,
        timestamp,
        wfhNote: wfhNote || note,
        actorRole: req.user.role,
        deviceId: deviceId || req.headers["x-device-id"],
      });
      return res.status(201).json(result);
    } catch (error) {
      return res
        .status(error.statusCode || 500)
        .json({ success: false, message: error.message });
    }
  }

  /**
   * Get structured break details for a specific attendance (or today's)
   */
  async getBreakDetails(req, res) {
    try {
      const result = await attendanceService.getBreakDetails({
        userId: req.user.id,
        employeeId: req.user.employee?.id,
        organizationId: req.user.organizationId,
        attendanceId: req.params.attendanceId || req.query.attendanceId,
      });
      return res.status(200).json(result);
    } catch (error) {
      return res
        .status(error.statusCode || 500)
        .json({ success: false, message: error.message });
    }
  }

  /**
   * Admin direct mark attendance for any employee (bypasses GPS/correction flow)
   */
  async adminMarkAttendance(req, res) {
    try {
      const { employeeId, date, status, checkIn, checkOut, reason } = req.body;
      if (!employeeId || !date || !status) {
        return res
          .status(400)
          .json({
            success: false,
            message: "employeeId, date, and status are required",
          });
      }
      const result = await attendanceService.adminMarkAttendance({
        adminUserId: req.user.id,
        organizationId: req.user.organizationId,
        employeeId,
        date,
        status,
        checkIn,
        checkOut,
        reason,
      });
      return res.status(200).json(result);
    } catch (error) {
      return res
        .status(error.statusCode || 500)
        .json({ success: false, message: error.message });
    }
  }

  /**
   * Trigger EOD absent marking manually (Admin only, for testing or on-demand)
   */
  async markAbsent(req, res) {
    try {
      const notificationService = require("../services/notification.service");
      const result = await notificationService.markAbsentEmployees(
        req.user.organizationId,
      );
      return res.status(200).json(result);
    } catch (error) {
      return res
        .status(error.statusCode || 500)
        .json({ success: false, message: error.message });
    }
  }
  /**
   * Sync offline-queued punches (batch) — called when device regains internet
   * Body: { punches: [{ id, type, timestamp, latitude?, longitude?, accuracy?, wfhNote? }] }
   */
  async syncOfflinePunches(req, res) {
    try {
      const { punches } = req.body;
      if (!Array.isArray(punches) || punches.length === 0) {
        return res
          .status(400)
          .json({
            success: false,
            message: "punches array is required and must not be empty",
          });
      }
      if (punches.length > 100) {
        return res.status(400).json({ success: false, message: "A maximum of 100 offline punches can be synced at once" });
      }
      const allowedTypes = new Set(["CHECK_IN", "CHECK_OUT", "BREAK_START", "BREAK_END", "WFH_CHECK_IN"]);
      const now = Date.now();
      const oldestAllowed = now - 31 * 24 * 60 * 60 * 1000;
      for (const punch of punches) {
        if (!punch || typeof punch !== "object" || !allowedTypes.has(punch.type)) {
          return res.status(400).json({ success: false, message: "Each offline punch must have a valid type" });
        }
        const punchTime = Date.parse(punch.timestamp);
        if (!Number.isFinite(punchTime) || punchTime < oldestAllowed || punchTime > now + 5 * 60 * 1000) {
          return res.status(400).json({ success: false, message: "Offline punch timestamps must be valid and within the last 31 days" });
        }
        if (punch.latitude !== undefined && (!Number.isFinite(Number(punch.latitude)) || Number(punch.latitude) < -90 || Number(punch.latitude) > 90)) {
          return res.status(400).json({ success: false, message: "Invalid offline punch latitude" });
        }
        if (punch.longitude !== undefined && (!Number.isFinite(Number(punch.longitude)) || Number(punch.longitude) < -180 || Number(punch.longitude) > 180)) {
          return res.status(400).json({ success: false, message: "Invalid offline punch longitude" });
        }
      }
      const result = await attendanceService.syncOfflinePunches(
        req.user.id,
        req.user.organizationId,
        punches,
      );
      return res.status(200).json(result);
    } catch (error) {
      return res
        .status(error.statusCode || 500)
        .json({ success: false, message: error.message });
    }
  }
}

module.exports = new AttendanceController();
