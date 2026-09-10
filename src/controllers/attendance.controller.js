const attendanceService = require("../services/attendance.service");

class AttendanceController {
  /**
   * Clock in with GPS coordinates and shift policy check
   */
  async checkIn(req, res) {
    try {
      const { latitude, longitude, accuracy, timestamp, employeeId } = req.body;
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
      const { latitude, longitude, accuracy, timestamp, employeeId } = req.body;
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
      const { latitude, longitude } = req.body;
      const result = await attendanceService.startBreak({
        userId: req.user.id,
        employeeId: req.user.employee?.id,
        organizationId: req.user.organizationId,
        latitude,
        longitude,
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
      const { latitude, longitude } = req.body;
      const result = await attendanceService.endBreak({
        userId: req.user.id,
        employeeId: req.user.employee?.id,
        organizationId: req.user.organizationId,
        latitude,
        longitude,
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
        req.user.organizationId
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
        req.query
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
   * Get all organization attendance logs (Admins & Managers)
   */
  async getAllAttendance(req, res) {
    try {
      const result = await attendanceService.getAllAttendance(
        req.user.organizationId,
        req.query
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
   * Get today's attendance summary metrics
   */
  async getAttendanceSummary(req, res) {
    try {
      const result = await attendanceService.getAttendanceSummary(
        req.user.organizationId,
        req.query.date
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
      return res.status(200).json(result);
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        message: error.message,
      });
    }
  }
}

module.exports = new AttendanceController();
