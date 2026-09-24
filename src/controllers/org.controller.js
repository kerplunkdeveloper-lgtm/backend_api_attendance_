const orgService = require("../services/org.service");

module.exports = {
  async get(req, res) {
    try {
      const data = await orgService.getSettings(req.user.organizationId);
      return res.json({ success: true, data });
    } catch (err) {
      return res
        .status(err.statusCode || 400)
        .json({ success: false, message: err.message });
    }
  },
  async update(req, res) {
    try {
      const data = await orgService.updateSettings(
        req.user.organizationId,
        req.body,
      );
      return res.json({ success: true, message: "Organization updated", data });
    } catch (err) {
      return res
        .status(err.statusCode || 400)
        .json({ success: false, message: err.message });
    }
  },
};
