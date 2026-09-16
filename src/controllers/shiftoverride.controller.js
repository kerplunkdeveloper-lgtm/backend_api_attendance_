const shiftOverrideService = require("../services/shiftoverride.service");

class ShiftOverrideController {
  async setOverride(req, res) {
    try {
      const result = await shiftOverrideService.setOverride(req.user.organizationId, req.user.id, req.body);
      return res.status(200).json(result);
    } catch (error) {
      return res.status(error.statusCode || 500).json({ success: false, message: error.message });
    }
  }

  async deleteOverride(req, res) {
    try {
      const { employeeId, date } = req.query;
      if (!employeeId || !date) {
        return res.status(400).json({ success: false, message: "employeeId and date are required" });
      }
      const result = await shiftOverrideService.deleteOverride(req.user.organizationId, employeeId, date);
      return res.status(200).json(result);
    } catch (error) {
      return res.status(error.statusCode || 500).json({ success: false, message: error.message });
    }
  }

  async getEmployeeOverrides(req, res) {
    try {
      const employeeId = req.params.employeeId || req.user.employee?.id;
      if (!employeeId) return res.status(400).json({ success: false, message: "employeeId is required" });
      if (req.user.role === "EMPLOYEE" && req.user.employee?.id !== employeeId) {
        return res.status(403).json({ success: false, message: "Unauthorized to view overrides of another employee" });
      }
      const result = await shiftOverrideService.getEmployeeOverrides(req.user.organizationId, employeeId, req.query);
      return res.status(200).json({ success: true, overrides: result });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ success: false, message: error.message });
    }
  }

  async getOrganizationOverrides(req, res) {
    try {
      const result = await shiftOverrideService.getOrganizationOverrides(req.user.organizationId, req.query);
      return res.status(200).json({ success: true, overrides: result });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ success: false, message: error.message });
    }
  }
}

module.exports = new ShiftOverrideController();
