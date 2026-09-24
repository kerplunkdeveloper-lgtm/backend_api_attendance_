const payslipTemplateService = require("../services/payslip-template.service");

class PayslipTemplateController {
  async getPresets(req, res) {
    try {
      const presets = payslipTemplateService.getPresets();
      return res.status(200).json({ success: true, data: presets });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  async getTemplate(req, res) {
    try {
      const template = await payslipTemplateService.getOrganizationTemplate(
        req.user.organizationId,
      );
      return res.status(200).json({ success: true, data: template });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
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
      return res.status(400).json({ success: false, message: err.message });
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
      return res.status(400).json({ success: false, message: err.message });
    }
  }

  async uploadAsset(req, res) {
    try {
      if (!req.file) {
        return res
          .status(400)
          .json({ success: false, message: "No image file provided" });
      }

      // Convert uploaded file to base64 Data URI for immediate reliable cross-environment rendering
      const mime = req.file.mimetype || "image/png";
      const base64 = req.file.buffer.toString("base64");
      const dataUri = `data:${mime};base64,${base64}`;

      const { assetType } = req.body; // 'logo' or 'signature'
      const updateData = {};
      if (assetType === "signature") {
        updateData.signatureImageUrl = dataUri;
      } else {
        updateData.logoUrl = dataUri;
      }

      const updated = await payslipTemplateService.upsertOrganizationTemplate(
        req.user.organizationId,
        updateData,
      );

      return res.status(200).json({
        success: true,
        message: `${assetType === "signature" ? "Authorized Signature" : "Company Logo"} uploaded successfully`,
        data: { url: dataUri, template: updated },
      });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
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
      return res.status(500).json({ success: false, message: err.message });
    }
  }
}

module.exports = new PayslipTemplateController();
