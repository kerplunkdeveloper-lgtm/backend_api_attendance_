const appraisalService = require("../services/appraisal.service");
const { sendControllerError } = require("../utils/controllerError");

module.exports = {
  async createCycle(req, res) {
    try {
      const data = await appraisalService.createCycle(
        req.user.organizationId,
        req.body,
      );
      return res.status(201).json({ success: true, data });
    } catch (err) {
      return sendControllerError(res, err);
    }
  },
  async list(req, res) {
    try {
      const data = await appraisalService.listCycles(req.user.organizationId);
      return res.json({ success: true, data });
    } catch (err) {
      return sendControllerError(res, err);
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
      return sendControllerError(res, err);
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
      return sendControllerError(res, err);
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
      return sendControllerError(res, err);
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
      return sendControllerError(res, err);
    }
  },
};
