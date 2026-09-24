const appraisalService = require("../services/appraisal.service");

module.exports = {
  async createCycle(req, res) {
    try {
      const data = await appraisalService.createCycle(
        req.user.organizationId,
        req.body,
      );
      return res.status(201).json({ success: true, data });
    } catch (err) {
      return res
        .status(err.statusCode || 400)
        .json({ success: false, message: err.message });
    }
  },
  async list(req, res) {
    try {
      const data = await appraisalService.listCycles(req.user.organizationId);
      return res.json({ success: true, data });
    } catch (err) {
      return res
        .status(err.statusCode || 400)
        .json({ success: false, message: err.message });
    }
  },
  async get(req, res) {
    try {
      const data = await appraisalService.getCycle(
        req.user.organizationId,
        req.params.id,
      );
      return res.json({ success: true, data });
    } catch (err) {
      return res
        .status(err.statusCode || 400)
        .json({ success: false, message: err.message });
    }
  },
  async mine(req, res) {
    try {
      const data = await appraisalService.myReview(
        req.user.organizationId,
        req.user.id,
      );
      return res.json({ success: true, data });
    } catch (err) {
      return res
        .status(err.statusCode || 400)
        .json({ success: false, message: err.message });
    }
  },
  async submitSelf(req, res) {
    try {
      const data = await appraisalService.submitSelf(
        req.user.organizationId,
        req.user.id,
        req.params.id,
        req.body,
      );
      return res.json({ success: true, data });
    } catch (err) {
      return res
        .status(err.statusCode || 400)
        .json({ success: false, message: err.message });
    }
  },
  async submitManager(req, res) {
    try {
      const data = await appraisalService.submitManager(
        req.user.organizationId,
        req.user.id,
        req.params.id,
        req.body,
      );
      return res.json({ success: true, data });
    } catch (err) {
      return res
        .status(err.statusCode || 400)
        .json({ success: false, message: err.message });
    }
  },
};
