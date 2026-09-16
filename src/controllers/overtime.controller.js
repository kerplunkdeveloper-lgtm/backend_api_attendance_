const overtimeService = require("../services/overtime.service");

class OvertimeController {
  async requestOvertime(req, res) {
    try {
      const result = await overtimeService.requestOvertime(req.user.organizationId, req.user.id, req.body);
      return res.status(201).json(result);
    } catch (error) {
      return res.status(error.statusCode || 500).json({ success: false, message: error.message });
    }
  }

  async getMyRequests(req, res) {
    try {
      const result = await overtimeService.getMyOvertimeRequests(req.user.id, req.user.organizationId);
      return res.status(200).json({ success: true, requests: result });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ success: false, message: error.message });
    }
  }

  async getAllRequests(req, res) {
    try {
      const result = await overtimeService.getOvertimeRequests(req.user.organizationId, req.query);
      return res.status(200).json({ success: true, ...result });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ success: false, message: error.message });
    }
  }

  async reviewRequest(req, res) {
    try {
      const result = await overtimeService.reviewOvertimeRequest(
        req.user.organizationId,
        req.params.id,
        req.user.id,
        req.body
      );
      return res.status(200).json(result);
    } catch (error) {
      return res.status(error.statusCode || 500).json({ success: false, message: error.message });
    }
  }
}

module.exports = new OvertimeController();
