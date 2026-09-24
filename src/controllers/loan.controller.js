const loanService = require("../services/loan.service");

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
      return res
        .status(err.statusCode || 400)
        .json({ success: false, message: err.message });
    }
  },
  async list(req, res) {
    try {
      const data = await loanService.list(req.user.organizationId, req.user);
      return res.json({ success: true, data });
    } catch (err) {
      return res
        .status(err.statusCode || 400)
        .json({ success: false, message: err.message });
    }
  },
  async review(req, res) {
    try {
      const data = await loanService.review(
        req.user.organizationId,
        req.params.id,
        req.body,
        req.user.id,
      );
      return res.json({ success: true, data });
    } catch (err) {
      return res
        .status(err.statusCode || 400)
        .json({ success: false, message: err.message });
    }
  },
};
