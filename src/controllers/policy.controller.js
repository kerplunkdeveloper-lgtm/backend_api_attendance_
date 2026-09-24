const policyService = require("../services/policy.service");

class PolicyController {
  async getPolicy(req, res) {
    try {
      const result = await policyService.getPolicy(req.user.organizationId);
      return res
        .status(200)
        .json({ success: true, policy: result, data: result });
    } catch (error) {
      return res
        .status(error.statusCode || 500)
        .json({ success: false, message: error.message });
    }
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
    } catch (error) {
      return res
        .status(error.statusCode || 500)
        .json({ success: false, message: error.message });
    }
  }
}

module.exports = new PolicyController();
