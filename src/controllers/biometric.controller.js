const biometricService = require("../services/biometric.service");
const { sendControllerError } = require("../utils/controllerError");

module.exports = {
  async create(req, res) {
    try {
      const data = await biometricService.createDevice(
        req.user.organizationId,
        req.body,
      );
      return res.status(201).json({
        success: true,
        data,
        message: "Copy the apiKey now. It is shown only once.",
      });
    } catch (err) {
      return sendControllerError(res, err);
    }
  },
  async list(req, res) {
    try {
      const data = await biometricService.listDevices(req.user.organizationId);
      return res.json({ success: true, data });
    } catch (err) {
      return sendControllerError(res, err);
    }
  },
  async revoke(req, res) {
    try {
      const data = await biometricService.revokeDevice(
        req.user.organizationId,
        req.params.id,
      );
      return res.json({ success: true, data });
    } catch (err) {
      return sendControllerError(res, err);
    }
  },
  async punch(req, res) {
    try {
      const apiKey = req.headers["x-device-key"] || req.body.apiKey;
      const data = await biometricService.ingestPunch({
        apiKey,
        employeeCode: req.body.employeeCode,
        punchType: req.body.punchType,
        timestamp: req.body.timestamp,
      });
      return res.json({ success: true, data });
    } catch (err) {
      return sendControllerError(res, err);
    }
  },
};
