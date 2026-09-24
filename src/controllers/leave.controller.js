const leaveService = require("../services/leave.service");
const { paginated, fail } = require("../utils/response");

class LeaveController {
  async createLeaveType(req, res) {
    try {
      const result = await leaveService.createLeaveType(
        req.user.organizationId,
        req.body,
      );
      return res
        .status(201)
        .json({ success: true, message: "Leave type created", data: result });
    } catch (err) {
      return res
        .status(err.statusCode || 400)
        .json({ success: false, message: err.message });
    }
  }

  async getLeaveTypes(req, res) {
    try {
      const result = await leaveService.getLeaveTypes(req.user.organizationId);
      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      return res
        .status(err.statusCode || 500)
        .json({ success: false, message: err.message });
    }
  }

  async getLeaveBalances(req, res) {
    try {
      const result = await leaveService.getLeaveBalances(
        req.user.id,
        req.user.organizationId,
        req.query.year,
      );
      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      return res
        .status(err.statusCode || 500)
        .json({ success: false, message: err.message });
    }
  }

  async createLeaveRequest(req, res) {
    try {
      const result = await leaveService.createLeaveRequest(
        req.user.id,
        req.user.organizationId,
        req.body,
        req.user.role,
      );
      return res
        .status(201)
        .json({
          success: true,
          message: "Leave request submitted",
          data: result,
        });
    } catch (err) {
      return res
        .status(err.statusCode || 400)
        .json({ success: false, message: err.message });
    }
  }

  async getMyLeaveRequests(req, res) {
    try {
      const result = await leaveService.getMyLeaveRequests(
        req.user.id,
        req.user.organizationId,
      );
      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      return res
        .status(err.statusCode || 500)
        .json({ success: false, message: err.message });
    }
  }

  async getAllLeaveRequests(req, res) {
    try {
      const result = await leaveService.getAllLeaveRequests(
        req.user.organizationId,
        req.query,
      );
      // `leaveRequests` is the key the approvals inbox reads.
      return paginated(res, result, { leaveRequests: result.records ?? [] });
    } catch (err) {
      return fail(res, err);
    }
  }

  async reviewLeaveRequest(req, res) {
    try {
      const { id } = req.params;
      const result = await leaveService.reviewLeaveRequest(
        id,
        req.user.organizationId,
        req.user.id,
        req.body,
      );
      return res
        .status(200)
        .json({
          success: true,
          message: `Leave request ${result.status.toLowerCase()}`,
          data: result,
        });
    } catch (err) {
      return res
        .status(err.statusCode || 400)
        .json({ success: false, message: err.message });
    }
  }

  async cancelLeaveRequest(req, res) {
    try {
      const { id } = req.params;
      const result = await leaveService.cancelLeaveRequest(
        id,
        req.user.organizationId,
        req.user.id,
        req.user.role,
      );
      return res
        .status(200)
        .json({
          success: true,
          message: "Leave request cancelled",
          data: result,
        });
    } catch (err) {
      return res
        .status(err.statusCode || 400)
        .json({ success: false, message: err.message });
    }
  }

  async updateLeaveType(req, res) {
    try {
      const result = await leaveService.updateLeaveType(
        req.user.organizationId,
        req.params.id,
        req.body,
      );
      return res.json({
        success: true,
        message: "Leave type updated",
        data: result,
      });
    } catch (err) {
      return res
        .status(err.statusCode || 400)
        .json({ success: false, message: err.message });
    }
  }

  async deleteLeaveType(req, res) {
    try {
      const result = await leaveService.deleteLeaveType(
        req.user.organizationId,
        req.params.id,
      );
      return res.json({ success: true, data: result });
    } catch (err) {
      return res
        .status(err.statusCode || 400)
        .json({ success: false, message: err.message });
    }
  }

  async carryForward(req, res) {
    try {
      const result = await leaveService.carryForward(
        req.user.organizationId,
        req.body,
      );
      return res.json({ success: true, data: result });
    } catch (err) {
      return res
        .status(err.statusCode || 400)
        .json({ success: false, message: err.message });
    }
  }

  async createHoliday(req, res) {
    try {
      const result = await leaveService.createHoliday(
        req.user.organizationId,
        req.body,
      );
      return res
        .status(201)
        .json({ success: true, message: "Holiday created", data: result });
    } catch (err) {
      return res
        .status(err.statusCode || 400)
        .json({ success: false, message: err.message });
    }
  }

  async getHolidays(req, res) {
    try {
      const result = await leaveService.getHolidays(req.user.organizationId);
      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      return res
        .status(err.statusCode || 500)
        .json({ success: false, message: err.message });
    }
  }
}

module.exports = new LeaveController();
