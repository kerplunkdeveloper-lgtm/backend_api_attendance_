const overtimeService = require("../services/overtime.service");
const { paginated, fail } = require("../utils/response");

class OvertimeController {
  async requestOvertime(req, res) {
    try {
      const result = await overtimeService.requestOvertime(
        req.user.organizationId,
        req.user.id,
        req.body,
      );
      return res.status(201).json(result);
    } catch (error) {
      return res
        .status(error.statusCode || 500)
        .json({ success: false, message: error.message });
    }
  }

  async getMyRequests(req, res) {
    try {
      const result = await overtimeService.getMyOvertimeRequests(
        req.user.id,
        req.user.organizationId,
      );
      return res
        .status(200)
        .json({ success: true, data: result, requests: result });
    } catch (error) {
      return fail(res, error);
    }
  }

  async getAllRequests(req, res) {
    try {
      const result = await overtimeService.getOvertimeRequests(
        req.user.organizationId,
        { ...req.query, ...(req.forcedStatus ? { status: req.forcedStatus } : {}) },
      );
      // `overtimeRequests` is the key the approvals inbox reads.
      return paginated(res, result, { overtimeRequests: result.records ?? [] });
    } catch (error) {
      return fail(res, error);
    }
  }

  async reviewRequest(req, res) {
    try {
      const result = await overtimeService.reviewOvertimeRequest(
        req.user.organizationId,
        req.params.id,
        req.user.id,
        req.body,
      );
      return res.status(200).json(result);
    } catch (error) {
      return res
        .status(error.statusCode || 500)
        .json({ success: false, message: error.message });
    }
  }
}

module.exports = new OvertimeController();
