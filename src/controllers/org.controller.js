const orgService = require("../services/org.service");
const { sendControllerError } = require("../utils/controllerError");

const pickFile = (req) => req.file || req.files?.logo?.[0] || req.files?.image?.[0] || req.files?.file?.[0] || null;

module.exports = {
  async uploadLogo(req, res) {
    try {
      const data = await orgService.uploadLogo(req.user.organizationId, pickFile(req));
      return res.json({ success: true, message: "Logo updated", data });
    } catch (err) {
      return sendControllerError(res, err);
    }
  },
  async removeLogo(req, res) {
    try {
      const data = await orgService.removeLogo(req.user.organizationId);
      return res.json({ success: true, message: "Logo removed", data });
    } catch (err) {
      return sendControllerError(res, err);
    }
  },
  async get(req, res) {
    try {
      const data = await orgService.getSettings(req.user.organizationId);
      return res.json({ success: true, data });
    } catch (err) {
      return sendControllerError(res, err);
    }
  },
  async update(req, res) {
    try {
      const data = await orgService.updateSettings(
        req.user.organizationId,
        req.body,
        req.user,
      );
      return res.json({ success: true, message: "Organization updated", data });
    } catch (err) {
      return sendControllerError(res, err);
    }
  },
};
