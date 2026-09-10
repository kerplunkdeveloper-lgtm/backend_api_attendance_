const correctionService = require("../services/correction.service");

class CorrectionController {
  async create(req, res) {
    try {
      const result = await correctionService.createCorrectionRequest(
        req.user.id,
        req.user.organizationId,
        req.body
      );
      return res.status(201).json({
        success: true,
        message: "Attendance correction request submitted successfully",
        data: result,
      });
    } catch (error) {
      return res.status(error.statusCode || 400).json({
        success: false,
        message: error.message,
      });
    }
  }

  async getMyRequests(req, res) {
    try {
      const result = await correctionService.getMyRequests(
        req.user.id,
        req.user.organizationId
      );
      return res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        message: error.message,
      });
    }
  }

  async getAllRequests(req, res) {
    try {
      const result = await correctionService.getAllRequests(
        req.user.organizationId,
        req.query
      );
      return res.status(200).json({
        success: true,
        ...result,
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        message: error.message,
      });
    }
  }

  async review(req, res) {
    try {
      const { id } = req.params;
      const result = await correctionService.reviewRequest(
        id,
        req.user.organizationId,
        req.user.id,
        req.body
      );
      return res.status(200).json({
        success: true,
        message: `Correction request ${result.status.toLowerCase()} successfully`,
        data: result,
      });
    } catch (error) {
      return res.status(error.statusCode || 400).json({
        success: false,
        message: error.message,
      });
    }
  }
}

module.exports = new CorrectionController();
