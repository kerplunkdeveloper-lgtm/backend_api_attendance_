const compOffService = require("../services/compoff.service");
const prisma = require("../config/database");

class CompOffController {
  async getMyBalance(req, res) {
    try {
      let employee = req.user.employee;
      if (!employee) {
        employee = await prisma.employee.findFirst({
          where: { userId: req.user.id, organizationId: req.user.organizationId },
        });
      }
      if (!employee) {
        return res.status(404).json({ success: false, message: "Employee profile not found for this user account" });
      }
      const result = await compOffService.getOrCreateBalance(employee.id, req.user.organizationId);
      return res.status(200).json({ success: true, ...result });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ success: false, message: error.message });
    }
  }

  async getOrganizationBalances(req, res) {
    try {
      const result = await compOffService.getOrganizationBalances(req.user.organizationId);
      return res.status(200).json({ success: true, balances: result });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ success: false, message: error.message });
    }
  }

  async creditCompOff(req, res) {
    try {
      const { employeeId, days, reason, referenceDate } = req.body;
      if (!employeeId) return res.status(400).json({ success: false, message: "employeeId is required" });
      const result = await compOffService.creditCompOff(req.user.organizationId, employeeId, {
        days, reason, referenceDate, createdBy: req.user.id,
      });
      return res.status(200).json(result);
    } catch (error) {
      return res.status(error.statusCode || 500).json({ success: false, message: error.message });
    }
  }

  async redeemCompOff(req, res) {
    try {
      let employee = req.user.employee;
      if (!employee) {
        employee = await prisma.employee.findFirst({
          where: { userId: req.user.id, organizationId: req.user.organizationId },
        });
      }
      if (!employee) {
        return res.status(404).json({ success: false, message: "Employee profile not found for this user account" });
      }
      const { days, reason } = req.body;
      const result = await compOffService.redeemCompOff(req.user.organizationId, employee.id, { days, reason });
      return res.status(200).json(result);
    } catch (error) {
      return res.status(error.statusCode || 500).json({ success: false, message: error.message });
    }
  }
}

module.exports = new CompOffController();
