const leaveService = require("../services/leave.service");

class LeaveController {
  async createLeaveType(req, res) {
    try {
      const result = await leaveService.createLeaveType(req.user.organizationId, req.body);
      return res.status(201).json({ success: true, message: "Leave type created", data: result });
    } catch (err) {
      return res.status(err.statusCode || 400).json({ success: false, message: err.message });
    }
  }

  async getLeaveTypes(req, res) {
    try {
      const result = await leaveService.getLeaveTypes(req.user.organizationId);
      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      return res.status(err.statusCode || 500).json({ success: false, message: err.message });
    }
  }

  async getLeaveBalances(req, res) {
    try {
      const result = await leaveService.getLeaveBalances(req.user.id, req.user.organizationId, req.query.year);
      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      return res.status(err.statusCode || 500).json({ success: false, message: err.message });
    }
  }

  async createLeaveRequest(req, res) {
    try {
      const result = await leaveService.createLeaveRequest(req.user.id, req.user.organizationId, req.body);
      return res.status(201).json({ success: true, message: "Leave request submitted", data: result });
    } catch (err) {
      return res.status(err.statusCode || 400).json({ success: false, message: err.message });
    }
  }

  async getMyLeaveRequests(req, res) {
    try {
      const result = await leaveService.getMyLeaveRequests(req.user.id, req.user.organizationId);
      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      return res.status(err.statusCode || 500).json({ success: false, message: err.message });
    }
  }

  async getAllLeaveRequests(req, res) {
    try {
      const result = await leaveService.getAllLeaveRequests(req.user.organizationId, req.query);
      return res.status(200).json({ success: true, ...result });
    } catch (err) {
      return res.status(err.statusCode || 500).json({ success: false, message: err.message });
    }
  }

  async reviewLeaveRequest(req, res) {
    try {
      const { id } = req.params;
      const result = await leaveService.reviewLeaveRequest(id, req.user.organizationId, req.user.id, req.body);
      return res.status(200).json({ success: true, message: `Leave request ${result.status.toLowerCase()}`, data: result });
    } catch (err) {
      return res.status(err.statusCode || 400).json({ success: false, message: err.message });
    }
  }

  async createHoliday(req, res) {
    try {
      const result = await leaveService.createHoliday(req.user.organizationId, req.body);
      return res.status(201).json({ success: true, message: "Holiday created", data: result });
    } catch (err) {
      return res.status(err.statusCode || 400).json({ success: false, message: err.message });
    }
  }

  async getHolidays(req, res) {
    try {
      const result = await leaveService.getHolidays(req.user.organizationId);
      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      return res.status(err.statusCode || 500).json({ success: false, message: err.message });
    }
  }
}

module.exports = new LeaveController();
