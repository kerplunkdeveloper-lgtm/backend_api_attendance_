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
  async credentials(req, res) {
    try {
      const data = await biometricService.listCredentials(req.user.organizationId);
      return res.json({ success: true, data });
    } catch (err) { return sendControllerError(res, err); }
  },
  async assignCard(req, res) {
    try {
      const data = await biometricService.assignCard(req.user.organizationId, req.body);
      return res.status(201).json({ success: true, data, message: "Card assigned to employee" });
    } catch (err) { return sendControllerError(res, err); }
  },
  async removeCard(req, res) {
    try {
      const data = await biometricService.removeCard(req.user.organizationId, req.params.id);
      return res.json({ success: true, data });
    } catch (err) { return sendControllerError(res, err); }
  },
  async punch(req, res) {
    try {
      const apiKey = req.headers["x-device-key"] || req.body.apiKey;
      const data = await biometricService.ingestPunch({
        apiKey,
        employeeCode: req.body.employeeCode,
        cardUid: req.body.cardUid || req.body.cardId || req.body.badgeId,
        credentialValue: req.body.credentialValue,
        credentialType: req.body.credentialType,
        punchType: req.body.punchType,
        timestamp: req.body.timestamp,
      });
      return res.json({ success: true, data });
    } catch (err) {
      return sendControllerError(res, err);
    }
  },
};
