const loanService = require("../services/loan.service");
const { sendControllerError } = require("../utils/controllerError");

module.exports = {
  async apply(req, res) {
    try {
      const data = await loanService.apply(
        req.user.organizationId,
        req.user,
        req.body,
      );
      return res.status(201).json({ success: true, data });
    } catch (err) {
      return sendControllerError(res, err);
    }
  },
  async list(req, res) {
    try {
      const data = await loanService.list(req.user.organizationId, req.user);
      return res.json({ success: true, data });
    } catch (err) {
      return sendControllerError(res, err);
    }
  },
  async review(req, res) {
    try {
      const data = await loanService.review(
        req.user.organizationId,
        req.params.id,
        req.body,
        req.user.id,
        req.user.role,
      );
      return res.json({ success: true, data });
    } catch (err) {
      return sendControllerError(res, err);
    }
  },
};
