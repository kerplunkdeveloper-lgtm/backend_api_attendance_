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
    } catch (err) { return fail(res, err); }
  }

  async getLeaveTypes(req, res) {
    try {
      const result = await leaveService.getLeaveTypes(req.user.organizationId);
      return res.status(200).json({ success: true, data: result });
    } catch (err) { return fail(res, err); }
  }

  async getLeaveBalances(req, res) {
    try {
      const result = await leaveService.getLeaveBalances(
        req.user.id,
        req.user.organizationId,
        req.query.year,
      );
      return res.status(200).json({ success: true, data: Array.isArray(result) ? result : result?.balances || [], ...(result?.employee ? { employee: result.employee, year: result.year } : {}) });
    } catch (err) { return fail(res, err); }
  }

  async getEmployeeLeaveBalances(req, res) {
    try {
      const result = await leaveService.getEmployeeLeaveBalances(req.user.organizationId, req.params.employeeId, req.query.year);
      if (!result) return res.status(404).json({ success: false, message: "Employee not found" });
      return res.status(200).json({ success: true, data: result });
    } catch (err) { return fail(res, err); }
  }

  async getTeamLeaveBalances(req, res) {
    try {
      const result = await leaveService.getTeamLeaveBalanceSummaries(req.user.organizationId, req.query.year);
      return res.status(200).json({ success: true, data: result });
    } catch (err) { return fail(res, err); }
  }

  async getDepartmentConflicts(req, res) {
    try {
      const employeeId = req.query.employeeId || req.user.employee?.id;
      if (!employeeId) return res.status(404).json({ success: false, message: "Employee profile not found" });
      const result = await leaveService.getDepartmentConflicts(req.user.organizationId, employeeId, req.query.startDate, req.query.endDate);
      return res.status(200).json({ success: true, data: result });
    } catch (err) { return fail(res, err); }
  }

  async requestDateChange(req, res) {
    try {
      const result = await leaveService.requestLeaveDateChange(req.user.id, req.user.organizationId, req.params.id, req.body, req.user.role);
      return res.status(201).json({ success: true, message: "Date-change request submitted", data: result });
    } catch (err) { return fail(res, err); }
  }

  async getMyDateChanges(req, res) {
    try { return res.json({ success: true, data: await leaveService.getMyLeaveChangeRequests(req.user.id, req.user.organizationId) }); }
    catch (err) { return fail(res, err); }
  }

  async getDateChanges(req, res) {
    try { return res.json({ success: true, data: await leaveService.getAllLeaveChangeRequests(req.user.organizationId, req.query.status || "PENDING") }); }
    catch (err) { return fail(res, err); }
  }

  async reviewDateChange(req, res) {
    try { return res.json({ success: true, message: "Date-change request reviewed", data: await leaveService.reviewLeaveDateChange(req.params.id, req.user.organizationId, req.user.id, req.body, req.user.role) }); }
    catch (err) { return fail(res, err); }
  }

  async getEligibility(req, res) {
    try {
      const result = await leaveService.getEligibility(req.user.id, req.user.organizationId);
      return res.status(200).json({ success: true, data: result });
    } catch (err) { return fail(res, err); }
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
    } catch (err) { return fail(res, err); }
  }

  async getMyLeaveRequests(req, res) {
    try {
      const result = await leaveService.getMyLeaveRequests(
        req.user.id,
        req.user.organizationId,
      );
      return res.status(200).json({ success: true, data: result });
    } catch (err) { return fail(res, err); }
  }

  async getAllLeaveRequests(req, res) {
    try {
      const result = await leaveService.getAllLeaveRequests(
        req.user.organizationId,
        req.query,
        req.user.role,
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
        req.user.role,
      );
      return res
        .status(200)
        .json({
          success: true,
          message: `Leave request ${result.status.toLowerCase()}`,
          data: result,
        });
    } catch (err) { return fail(res, err); }
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
    } catch (err) { return fail(res, err); }
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
    } catch (err) { return fail(res, err); }
  }

  async deleteLeaveType(req, res) {
    try {
      const result = await leaveService.deleteLeaveType(
        req.user.organizationId,
        req.params.id,
      );
      return res.json({ success: true, data: result });
    } catch (err) { return fail(res, err); }
  }

  async carryForward(req, res) {
    try {
      const result = await leaveService.carryForward(
        req.user.organizationId,
        req.body,
      );
      return res.json({ success: true, data: result });
    } catch (err) { return fail(res, err); }
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
    } catch (err) { return fail(res, err); }
  }

  async getHolidays(req, res) {
    try {
      const result = await leaveService.getHolidays(req.user.organizationId);
      return res.status(200).json({ success: true, data: result });
    } catch (err) { return fail(res, err); }
  }
}

module.exports = new LeaveController();
