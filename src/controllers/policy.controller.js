const policyService = require("../services/policy.service");
const companyPolicyService = require("../services/company-policy.service");
const { sendControllerError } = require("../utils/controllerError");

class PolicyController {
  async listCompanyPolicies(req, res) {
    try { return res.json({ success: true, policies: await companyPolicyService.list(req.user.organizationId, req.user.role) }); }
    catch (error) { return sendControllerError(res, error); }
  }
  async importCompanyPolicy(req, res) {
    try { return res.status(201).json({ success: true, policy: await companyPolicyService.create(req.user.organizationId, req.user, req.body, req.file), message: "Company policy imported" }); }
    catch (error) { return sendControllerError(res, error); }
  }
  async updateCompanyPolicy(req, res) {
    try { return res.json({ success: true, policy: await companyPolicyService.update(req.user.organizationId, req.user, req.params.id, req.body), message: "Company policy updated" }); }
    catch (error) { return sendControllerError(res, error); }
  }
  async deleteCompanyPolicy(req, res) {
    try { await companyPolicyService.remove(req.user.organizationId, req.user, req.params.id); return res.json({ success: true, message: "Company policy deleted" }); }
    catch (error) { return sendControllerError(res, error); }
  }
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
