const apikeyService = require("../services/apikey.service");

module.exports = {
  async create(req, res) {
    try {
      const data = await apikeyService.createKey(
        req.user.organizationId,
        req.body.name,
      );
      return res
        .status(201)
        .json({
          success: true,
          message: "Copy the apiKey now. It is shown only once.",
          data,
        });
    } catch (err) {
      return res
        .status(err.statusCode || 400)
        .json({ success: false, message: err.message });
    }
  },
  async list(req, res) {
    try {
      const data = await apikeyService.listKeys(req.user.organizationId);
      return res.json({ success: true, data });
    } catch (err) {
      return res
        .status(err.statusCode || 400)
        .json({ success: false, message: err.message });
    }
  },
  async revoke(req, res) {
    try {
      const data = await apikeyService.revokeKey(
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
};
