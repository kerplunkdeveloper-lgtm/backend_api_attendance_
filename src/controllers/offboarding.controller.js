const offboardingService = require("../services/offboarding.service");

class OffboardingController {
  /**
   * POST /api/offboarding/initiate
   */
  async initiateExit(req, res, next) {
    try {
      let employeeId = req.body.employeeId;
      // If regular employee, force self-resignation
      if (req.user.role === "EMPLOYEE") {
        if (!req.user.employee) {
          return res.status(404).json({ success: false, message: "No employee profile found for current user" });
        }
        employeeId = req.user.employee.id;
      }

      const payload = { ...req.body, employeeId };
      const data = await offboardingService.initiateExit(req.user.organizationId, payload, req.user);

      return res.status(201).json({
        success: true,
        message: "Exit process initiated successfully",
        data,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/offboarding/my-exit
   * Logged-in employee's own exit status
   */
  async getMyExit(req, res, next) {
    try {
      if (!req.user.employee) {
        return res.status(404).json({ success: false, message: "No employee profile found" });
      }

      const prisma = require("../config/database");
      const activeExit = await prisma.employeeExit.findFirst({
        where: {
          employeeId: req.user.employee.id,
          organizationId: req.user.organizationId,
        },
        orderBy: { createdAt: "desc" },
      });

      if (!activeExit) {
        return res.status(200).json({ success: true, data: null });
      }

      const details = await offboardingService.getExitDetails(req.user.organizationId, activeExit.id);
      return res.status(200).json({ success: true, data: details });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/offboarding
   */
  async getExitList(req, res, next) {
    try {
      const data = await offboardingService.getExitList(req.user.organizationId, req.query);
      return res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/offboarding/:id
   */
  async getExitDetails(req, res, next) {
    try {
      const data = await offboardingService.getExitDetails(req.user.organizationId, req.params.id);
      return res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/offboarding/:id/review
   */
  async reviewResignation(req, res, next) {
    try {
      const data = await offboardingService.reviewResignation(
        req.user.organizationId,
        req.params.id,
        req.body,
        req.user
      );
      return res.status(200).json({ success: true, message: "Resignation review recorded", data });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /api/offboarding/:id/clearances/:clearanceId
   */
  async updateClearanceItem(req, res, next) {
    try {
      const data = await offboardingService.updateClearanceItem(
        req.user.organizationId,
        req.params.id,
        req.params.clearanceId,
        req.body,
        req.user
      );
      return res.status(200).json({ success: true, message: "Clearance updated", data });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/offboarding/:id/interview
   */
  async saveExitInterview(req, res, next) {
    try {
      const data = await offboardingService.saveExitInterview(
        req.user.organizationId,
        req.params.id,
        req.body,
        req.user
      );
      return res.status(200).json({ success: true, message: "Exit interview saved", data });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/offboarding/:id/calculate-settlement
   */
  async calculateFinalSettlement(req, res, next) {
    try {
      const data = await offboardingService.calculateFinalSettlement(
        req.user.organizationId,
        req.params.id,
        req.body
      );
      return res.status(200).json({ success: true, message: "Full & Final settlement calculated", data });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/offboarding/:id/disburse-and-terminate
   */
  async disburseSettlementAndTerminate(req, res, next) {
    try {
      const result = await offboardingService.disburseSettlementAndTerminate(
        req.user.organizationId,
        req.params.id,
        req.body,
        req.user
      );
      return res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/offboarding/:id/documents/:docType
   */
  async getExitDocumentData(req, res, next) {
    try {
      const data = await offboardingService.getExitDocumentData(
        req.user.organizationId,
        req.params.id,
        req.params.docType
      );
      return res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
}

const controller = new OffboardingController();
controller.initiateExit = controller.initiateExit.bind(controller);
controller.getMyExit = controller.getMyExit.bind(controller);
controller.getExitList = controller.getExitList.bind(controller);
controller.getExitDetails = controller.getExitDetails.bind(controller);
controller.reviewResignation = controller.reviewResignation.bind(controller);
controller.updateClearanceItem = controller.updateClearanceItem.bind(controller);
controller.saveExitInterview = controller.saveExitInterview.bind(controller);
controller.calculateFinalSettlement = controller.calculateFinalSettlement.bind(controller);
controller.disburseSettlementAndTerminate = controller.disburseSettlementAndTerminate.bind(controller);
controller.getExitDocumentData = controller.getExitDocumentData.bind(controller);

module.exports = controller;
