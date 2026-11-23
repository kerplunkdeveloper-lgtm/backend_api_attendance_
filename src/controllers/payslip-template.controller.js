const payslipTemplateService = require("../services/payslip-template.service");
const { sendControllerError } = require("../utils/controllerError");
const { assertStorageAvailable, addStorageObject } = require("../services/storage-quota.service");

class PayslipTemplateController {
  async getPresets(req, res) {
    try {
      const presets = payslipTemplateService.getPresets();
      return res.status(200).json({ success: true, data: presets });
    } catch (err) {
      return sendControllerError(res, err, { fallbackStatus: 500 });
    }
  }

  async getTemplate(req, res) {
    try {
      const template = await payslipTemplateService.getOrganizationTemplate(
        req.user.organizationId,
      );
      return res.status(200).json({ success: true, data: template });
    } catch (err) {
      return sendControllerError(res, err, { fallbackStatus: 500 });
    }
  }

  async saveTemplate(req, res) {
    try {
      const updated = await payslipTemplateService.upsertOrganizationTemplate(
        req.user.organizationId,
        req.body,
      );
      return res.status(200).json({
        success: true,
        message: "Payslip template customized and saved successfully",
        data: updated,
      });
    } catch (err) {
      return sendControllerError(res, err);
    }
  }

  async resetPreset(req, res) {
    try {
      const { presetKey } = req.body;
      const updated = await payslipTemplateService.resetToPreset(
        req.user.organizationId,
        presetKey,
      );
      return res.status(200).json({
        success: true,
        message: "Payslip template reset to preset defaults",
        data: updated,
      });
    } catch (err) {
      return sendControllerError(res, err);
    }
  }

  async uploadAsset(req, res) {
    try {
      if (!req.file) {
        return res
          .status(400)
          .json({ success: false, message: "No image file provided" });
      }

      await assertStorageAvailable(req.user.organizationId, req.file.size || req.file.buffer.length);

      const cloudinary = require("../config/cloudinary");
      const uploaded = await cloudinary.uploadBuffer(req.file.buffer, {
        folder: `workpulse/${req.user.organizationId}/payslip-assets`,
        resource_type: "image",
        transformation: [{ width: 1200, height: 1200, crop: "limit", quality: "auto", fetch_format: "auto" }],
      });
      const assetUrl = uploaded.secure_url || uploaded.url;
      await addStorageObject({ organizationId: req.user.organizationId, provider: "cloudinary", storageKey: uploaded.public_id, bytes: uploaded.bytes || req.file.buffer.length, mimeType: req.file.mimetype, purpose: "payslip-assets" });

      const { assetType } = req.body; // 'logo' or 'signature'
      const updateData = {};
      if (assetType === "signature") {
        updateData.signatureImageUrl = assetUrl;
      } else {
        updateData.logoUrl = assetUrl;
      }

      const updated = await payslipTemplateService.upsertOrganizationTemplate(
        req.user.organizationId,
        updateData,
      );

      return res.status(200).json({
        success: true,
        message: `${assetType === "signature" ? "Authorized Signature" : "Company Logo"} uploaded successfully`,
        data: { url: assetUrl, template: updated },
      });
    } catch (err) {
      return sendControllerError(res, err, { fallbackStatus: 500 });
    }
  }

  async uploadHtmlTemplate(req, res) {
    try {
      if (!req.file && !req.body.html) {
        return res
          .status(400)
          .json({
            success: false,
            message: "No template file or HTML text provided",
          });
      }

      let htmlContent = req.body.html || "";
      if (req.file) {
        htmlContent = req.file.buffer.toString("utf8");
      }

      const updated = await payslipTemplateService.upsertOrganizationTemplate(
        req.user.organizationId,
        {
          templateKey: "CUSTOM_HTML",
          customHtml: htmlContent,
          name: req.body.name || "Custom Uploaded HTML Template",
        },
      );

      return res.status(200).json({
        success: true,
        message: "Custom HTML payslip template uploaded and activated",
        data: updated,
      });
    } catch (err) {
      return sendControllerError(res, err, { fallbackStatus: 500 });
    }
  }
}

module.exports = new PayslipTemplateController();
