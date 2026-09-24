const statutoryService = require("../services/statutory.service");

function sendFile(res, file) {
  res.setHeader("Content-Type", file.mimeType);
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${file.fileName}"`,
  );
  return res.send(file.content);
}

class StatutoryController {
  async getDeclaration(req, res) {
    try {
      const employeeId =
        req.user.role === "EMPLOYEE"
          ? await statutoryService.resolveEmployee(
              req.user.organizationId,
              req.user,
            )
          : req.query.employeeId;
      if (!employeeId)
        return res
          .status(400)
          .json({ success: false, message: "employeeId is required" });
      const fy =
        req.query.financialYear || statutoryService.currentFinancialYear();
      const declaration = await statutoryService.getOrCreateDeclaration(
        req.user.organizationId,
        employeeId,
        fy,
      );
      const estimate = await statutoryService.estimateForEmployee(
        req.user.organizationId,
        employeeId,
        fy,
      );
      return res.json({
        success: true,
        data: { declaration, tax: estimate.tax },
      });
    } catch (err) {
      return res
        .status(err.statusCode || 400)
        .json({ success: false, message: err.message });
    }
  }

  async saveDeclaration(req, res) {
    try {
      const employeeId =
        req.user.role === "EMPLOYEE"
          ? await statutoryService.resolveEmployee(
              req.user.organizationId,
              req.user,
            )
          : req.body.employeeId;
      if (!employeeId)
        return res
          .status(400)
          .json({ success: false, message: "employeeId is required" });
      const declaration = await statutoryService.upsertDeclaration(
        req.user.organizationId,
        employeeId,
        req.body,
      );
      const estimate = await statutoryService.estimateForEmployee(
        req.user.organizationId,
        employeeId,
        declaration.financialYear,
      );
      return res.json({
        success: true,
        data: { declaration, tax: estimate.tax },
      });
    } catch (err) {
      return res
        .status(err.statusCode || 400)
        .json({ success: false, message: err.message });
    }
  }

  async previewTax(req, res) {
    try {
      const employeeId =
        req.query.employeeId ||
        (await statutoryService.resolveEmployee(
          req.user.organizationId,
          req.user,
        ));
      if (!employeeId)
        return res
          .status(400)
          .json({ success: false, message: "employeeId is required" });
      const data = await statutoryService.estimateForEmployee(
        req.user.organizationId,
        employeeId,
        req.query.financialYear,
      );
      return res.json({ success: true, data });
    } catch (err) {
      return res
        .status(err.statusCode || 400)
        .json({ success: false, message: err.message });
    }
  }

  async generateForm16(req, res) {
    try {
      const { employeeId, financialYear } = req.body;
      if (employeeId) {
        const data = await statutoryService.generateForm16(
          req.user.organizationId,
          employeeId,
          financialYear,
        );
        return res.json({ success: true, data });
      }
      const data = await statutoryService.generateForm16Batch(
        req.user.organizationId,
        financialYear,
      );
      return res.json({ success: true, data });
    } catch (err) {
      return res
        .status(err.statusCode || 400)
        .json({ success: false, message: err.message });
    }
  }

  async downloadForm16(req, res) {
    try {
      const employeeId =
        req.user.role === "EMPLOYEE"
          ? await statutoryService.resolveEmployee(
              req.user.organizationId,
              req.user,
            )
          : req.query.employeeId;
      const data = await statutoryService.generateForm16(
        req.user.organizationId,
        employeeId,
        req.query.financialYear,
      );
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.send(data.html);
    } catch (err) {
      return res
        .status(err.statusCode || 400)
        .json({ success: false, message: err.message });
    }
  }

  async exportPf(req, res) {
    try {
      const file = await statutoryService.exportPfEcr(
        req.user.organizationId,
        req.query.month,
        req.query.year,
        req.user.id,
      );
      return sendFile(res, file);
    } catch (err) {
      return res
        .status(err.statusCode || 400)
        .json({ success: false, message: err.message });
    }
  }

  async exportEsi(req, res) {
    try {
      const file = await statutoryService.exportEsi(
        req.user.organizationId,
        req.query.month,
        req.query.year,
        req.user.id,
      );
      return sendFile(res, file);
    } catch (err) {
      return res
        .status(err.statusCode || 400)
        .json({ success: false, message: err.message });
    }
  }

  async listExports(req, res) {
    try {
      const data = await statutoryService.listExports(req.user.organizationId);
      return res.json({ success: true, data });
    } catch (err) {
      return res
        .status(err.statusCode || 400)
        .json({ success: false, message: err.message });
    }
  }

  async downloadSavedExport(req, res) {
    try {
      const file = await statutoryService.getExport(
        req.user.organizationId,
        req.params.id,
      );
      return sendFile(res, file);
    } catch (err) {
      return res
        .status(err.statusCode || 400)
        .json({ success: false, message: err.message });
    }
  }

  async exportNeft(req, res) {
    try {
      const file = await statutoryService.exportNeft(
        req.user.organizationId,
        req.query.month,
        req.query.year,
        req.user.id,
      );
      return sendFile(res, file);
    } catch (err) {
      return res
        .status(err.statusCode || 400)
        .json({ success: false, message: err.message });
    }
  }
}

module.exports = new StatutoryController();
