const compOffService = require("../services/compoff.service");
const prisma = require("../config/database");
const { paginated, fail } = require("../utils/response");

const resolveOwnEmployee = async (req) =>
  req.user.employee ||
  (await prisma.employee.findFirst({
    where: { userId: req.user.id, organizationId: req.user.organizationId },
  }));

class CompOffController {
  async getMyBalance(req, res) {
    try {
      const employee = await resolveOwnEmployee(req);
      if (!employee) {
        return res
          .status(404)
          .json({
            success: false,
            message: "Employee profile not found for this user account",
          });
      }
      const result = await compOffService.getOrCreateBalance(
        employee.id,
        req.user.organizationId,
      );
      return res.status(200).json({ success: true, ...result, data: result });
    } catch (error) {
      return fail(res, error);
    }
  }

  async getMyHistory(req, res) {
    try {
      const employee = await resolveOwnEmployee(req);
      if (!employee) {
        return res
          .status(404)
          .json({
            success: false,
            message: "Employee profile not found for this user account",
          });
      }
      const result = await compOffService.getTransactionHistory(
        employee.id,
        req.user.organizationId,
        req.query,
      );
      return paginated(res, result, {
        history: result.records,
        transactions: result.records,
      });
    } catch (error) {
      return fail(res, error);
    }
  }

  async getOrganizationBalances(req, res) {
    try {
      const result = await compOffService.getOrganizationBalances(
        req.user.organizationId,
      );
      return res
        .status(200)
        .json({ success: true, data: result, balances: result });
    } catch (error) {
      return fail(res, error);
    }
  }

  async creditCompOff(req, res) {
    try {
      const { employeeId, days, reason, referenceDate } = req.body;
      if (!employeeId)
        return res
          .status(400)
          .json({ success: false, message: "employeeId is required" });
      const result = await compOffService.creditCompOff(
        req.user.organizationId,
        employeeId,
        {
          days,
          reason,
          referenceDate,
          createdBy: req.user.id,
        },
      );
      return res.status(200).json(result);
    } catch (error) {
      return res
        .status(error.statusCode || 500)
        .json({ success: false, message: error.message });
    }
  }

  async redeemCompOff(req, res) {
    try {
      const employee = await resolveOwnEmployee(req);
      if (!employee) {
        return res
          .status(404)
          .json({
            success: false,
            message: "Employee profile not found for this user account",
          });
      }
      // Clients have used three names for the same field.
      const { days, reason, requestedDate, date, leaveDate } = req.body;
      const result = await compOffService.redeemCompOff(
        req.user.organizationId,
        employee.id,
        {
          days,
          reason,
          requestedDate: requestedDate || date || leaveDate,
        },
      );
      return res.status(200).json(result);
    } catch (error) {
      return fail(res, error);
    }
  }

  async listPending(req, res) {
    try {
      const result = await compOffService.listPendingRedemptions(
        req.user.organizationId,
      );
      return res
        .status(200)
        .json({ success: true, data: result, requests: result });
    } catch (error) {
      return fail(res, error);
    }
  }

  async reviewRedemption(req, res) {
    try {
      const result = await compOffService.reviewRedemption(
        req.user.organizationId,
        req.params.id,
        req.user.id,
        req.body,
      );
      return res.status(200).json(result);
    } catch (error) {
      return fail(res, error);
    }
  }
}

module.exports = new CompOffController();
