const policyService = require("../services/policy.service");
const auditService = require("../services/audit.service");
const { sendControllerError } = require("../utils/controllerError");

class PolicyController {
  async getPolicy(req, res) {
    try {
      const result = await policyService.getPolicy(req.user.organizationId);
      return res
        .status(200)
        .json({ success: true, policy: result, data: result });
    } catch (error) { return sendControllerError(res, error); }
  }

  async upsertPolicy(req, res) {
    try {
      const result = await policyService.upsertPolicy(
        req.user.organizationId,
        req.body,
      );
      await auditService.logAction({
        organizationId: req.user.organizationId,
        userId: req.user.id,
        action: "UPDATE",
        entity: "ATTENDANCE_POLICY",
        entityId: result.id,
        eventType: "ATTENDANCE_POLICY_UPDATED",
        riskLevel: "MEDIUM",
        ipAddress: req.ip,
        details: {
          breakDeductionEnabled: result.breakDeductionEnabled,
          lunchDeductionEnabled: result.lunchDeductionEnabled,
          breakGraceMinutes: result.breakGraceMinutes,
          lunchGraceMinutes: result.lunchGraceMinutes,
          pauseDeductionSalaryBasis: result.pauseDeductionSalaryBasis,
          breakDeductionMethod: result.breakDeductionMethod,
          lunchDeductionMethod: result.lunchDeductionMethod,
          maxPauseDeductionPerDay: result.maxPauseDeductionPerDay,
        },
      });
      return res
        .status(200)
        .json({
          success: true,
          message: "Attendance policy updated",
          policy: result,
          data: result,
        });
    } catch (error) { return sendControllerError(res, error); }
  }
  async listLateComingRules(req, res) {
    try {
      const result = await policyService.listLateComingRules(req.user.organizationId);
      return res.status(200).json({ success: true, rules: result, data: result });
    } catch (error) { return sendControllerError(res, error); }
  }

  async createLateComingRule(req, res) {
    try {
      const result = await policyService.createLateComingRule(req.user.organizationId, req.body);
      return res.status(201).json({ success: true, message: "Late-coming LOP rule created", rule: result, data: result });
    } catch (error) { return sendControllerError(res, error); }
  }

  async updateLateComingRule(req, res) {
    try {
      const result = await policyService.updateLateComingRule(req.user.organizationId, req.params.id, req.body);
      return res.status(200).json({ success: true, message: "Late-coming LOP rule updated", rule: result, data: result });
    } catch (error) { return sendControllerError(res, error); }
  }

  async deleteLateComingRule(req, res) {
    try {
      await policyService.deleteLateComingRule(req.user.organizationId, req.params.id);
      return res.status(200).json({ success: true, message: "Late-coming LOP rule deleted" });
    } catch (error) { return sendControllerError(res, error); }
  }
}

module.exports = new PolicyController();
