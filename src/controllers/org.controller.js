const orgService = require("../services/org.service");
const auditService = require("../services/audit.service");
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
  async getOfferLetterTemplate(req, res) {
    try {
      const data = await orgService.getOfferLetterTemplate(req.user.organizationId);
      return res.json({ success: true, data });
    } catch (err) { return sendControllerError(res, err); }
  },
  async updateOfferLetterTemplate(req, res) {
    try {
      const data = await orgService.updateOfferLetterTemplate(req.user.organizationId, req.body);
      await auditService.logAction({
        organizationId: req.user.organizationId,
        userId: req.user.id,
        action: "UPDATE",
        entity: "OFFER_LETTER_TEMPLATE",
        eventType: "OFFER_LETTER_TEMPLATE_UPDATED",
        riskLevel: "LOW",
        ipAddress: req.ip,
        details: { version: data.version, sourceType: data.sourceType, sourceFileName: data.sourceFileName, status: data.status },
      });
      return res.json({ success: true, message: "Offer letter template saved", data });
    } catch (err) { return sendControllerError(res, err); }
  },
  async getExitDocumentTemplates(req, res) {
    try {
      const data = await orgService.getExitDocumentTemplates(req.user.organizationId);
      return res.json({ success: true, data });
    } catch (err) { return sendControllerError(res, err); }
  },
  async updateExitDocumentTemplates(req, res) {
    try {
      const data = await orgService.updateExitDocumentTemplates(req.user.organizationId, req.body);
      return res.json({ success: true, message: "Exit document templates saved", data });
    } catch (err) { return sendControllerError(res, err); }
  },
};
