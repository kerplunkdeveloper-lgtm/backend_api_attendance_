const payrollService = require("../services/payroll.service");
const prisma = require("../config/database");

async function resolvePeriod(req) {
  let { month, year, batchId } = req.body || {};
  if (batchId && (!month || !year)) {
    const slip = await prisma.payslip.findFirst({
      where: { id: batchId, organizationId: req.user.organizationId },
      select: { month: true, year: true },
    });
    if (slip) {
      month = slip.month;
      year = slip.year;
    }
  }
  return { month, year, remarks: req.body?.remarks };
}

class PayrollController {
  async upsertSalaryStructure(req, res) {
    try {
      const result = await payrollService.upsertSalaryStructure(
        req.user.organizationId,
        req.body,
      );
      return res
        .status(200)
        .json({
          success: true,
          message: "Salary structure updated",
          data: result,
        });
    } catch (err) {
      return res
        .status(err.statusCode || 400)
        .json({ success: false, message: err.message });
    }
  }

  async getSalaryStructure(req, res) {
    try {
      const { employeeId } = req.params;
      const result = await payrollService.getSalaryStructure(
        req.user.organizationId,
        employeeId,
      );
      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      return res
        .status(err.statusCode || 500)
        .json({ success: false, message: err.message });
    }
  }

  async calculate(req, res) {
    try {
      const { employeeId, month, year } = req.query;
      if (!month || !year) {
        return res
          .status(400)
          .json({ success: false, message: "month and year are required" });
      }
      const result = employeeId
        ? await payrollService.calculateEmployeePayroll(
            req.user.organizationId,
            employeeId,
            month,
            year,
          )
        : await payrollService.calculateOrganizationPayroll(
            req.user.organizationId,
            month,
            year,
          );
      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      return res
        .status(err.statusCode || 400)
        .json({ success: false, message: err.message });
    }
  }

  async generate(req, res) {
    try {
      const { month, year } = req.body;
      if (!month || !year) {
        return res
          .status(400)
          .json({ success: false, message: "month and year are required" });
      }
      const result = await payrollService.generateOrganizationPayslips(
        req.user.organizationId,
        month,
        year,
      );
      return res
        .status(201)
        .json({
          success: true,
          message: "Payslips generated successfully",
          data: result,
        });
    } catch (err) {
      return res
        .status(err.statusCode || 400)
        .json({ success: false, message: err.message });
    }
  }

  async getPayslips(req, res) {
    try {
      const result = await payrollService.getPayslips(
        req.user.organizationId,
        req.query,
      );
      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      return res
        .status(err.statusCode || 500)
        .json({ success: false, message: err.message });
    }
  }

  async getMyPayslips(req, res) {
    try {
      const result = await payrollService.getMyPayslips(
        req.user.id,
        req.user.organizationId,
      );
      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      return res
        .status(err.statusCode || 500)
        .json({ success: false, message: err.message });
    }
  }

  async requestPayslip(req, res) {
    try {
      const month = Number(req.body?.month);
      const year = Number(req.body?.year);
      const reason = String(req.body?.reason || "Payslip required").trim();
      const employee = req.user.employee;
      if (!employee?.id) {
        return res.status(400).json({ success: false, message: "Only employee accounts can request payslips." });
      }
      if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year < 2000 || year > 2200) {
        return res.status(400).json({ success: false, message: "A valid payslip month and year are required." });
      }
      const admins = await prisma.user.findMany({
        where: {
          organizationId: req.user.organizationId,
          isActive: true,
          role: { in: ["SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"] },
        },
        select: { id: true },
      });
      if (!admins.length) {
        return res.status(503).json({ success: false, message: "No HR or payroll administrator is available." });
      }
      const employeeName = `${employee.firstName || "Employee"} ${employee.lastName || ""}`.trim();
      await prisma.notification.createMany({
        data: admins.map((admin) => ({
          organizationId: req.user.organizationId,
          userId: admin.id,
          title: `Payslip request: ${month}/${year}`,
          message: `${employeeName} requested a payslip for ${month}/${year}. Reason: ${reason}`,
          type: "PAYROLL",
        })),
      });
      return res.status(201).json({ success: true, message: "Payslip request sent to HR and payroll." });
    } catch (err) {
      return res.status(err.statusCode || 500).json({ success: false, message: err.message });
    }
  }

  async approveBatch(req, res) {
    try {
      const { month, year, remarks } = await resolvePeriod(req);
      if (!month || !year) {
        return res
          .status(400)
          .json({ success: false, message: "month and year are required" });
      }
      const result = await payrollService.approvePayrollBatch(
        req.user.organizationId,
        month,
        year,
        req.user.id,
        remarks,
      );
      return res
        .status(200)
        .json({
          success: true,
          message: `Payroll batch approved for ${month}/${year}`,
          data: result,
        });
    } catch (err) {
      return res
        .status(err.statusCode || 400)
        .json({ success: false, message: err.message });
    }
  }

  async disburseBatch(req, res) {
    try {
      const { month, year, remarks } = await resolvePeriod(req);
      if (!month || !year) {
        return res
          .status(400)
          .json({ success: false, message: "month and year are required" });
      }
      const result = await payrollService.disbursePayrollBatch(
        req.user.organizationId,
        month,
        year,
        req.user.id,
        remarks,
      );
      return res
        .status(200)
        .json({
          success: true,
          message: `Payroll batch marked as disbursed for ${month}/${year}`,
          data: result,
        });
    } catch (err) {
      return res
        .status(err.statusCode || 400)
        .json({ success: false, message: err.message });
    }
  }

  async updateStatus(req, res) {
    try {
      const { id } = req.params;
      const { status, remarks } = req.body;
      if (!status) {
        return res
          .status(400)
          .json({ success: false, message: "status is required" });
      }
      const result = await payrollService.updatePayslipStatus(
        req.user.organizationId,
        id,
        status,
        req.user.id,
        remarks,
      );
      return res
        .status(200)
        .json({
          success: true,
          message: "Payslip status updated",
          data: result,
        });
    } catch (err) {
      return res
        .status(err.statusCode || 400)
        .json({ success: false, message: err.message });
    }
  }

  async getPayslipDetails(req, res) {
    try {
      const { id } = req.params;
      // Employees may only open their own payslip; salary is not org-public data.
      const restrictToEmployeeId =
        req.user.role === "EMPLOYEE" ? (req.user.employee?.id ?? null) : null;

      if (req.user.role === "EMPLOYEE" && !restrictToEmployeeId) {
        return res
          .status(403)
          .json({
            success: false,
            message: "No employee profile linked to this account",
          });
      }

      const result = await payrollService.getPayslipDetails(
        req.user.organizationId,
        id,
        restrictToEmployeeId,
      );
      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      return res
        .status(err.statusCode || 500)
        .json({ success: false, message: err.message });
    }
  }

  async getReports(req, res) {
    try {
      const { month, year } = req.query;
      if (!month || !year) {
        return res
          .status(400)
          .json({
            success: false,
            message: "month and year query parameters are required",
          });
      }
      const result = await payrollService.getPayrollReports(
        req.user.organizationId,
        month,
        year,
      );
      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      return res
        .status(err.statusCode || 500)
        .json({ success: false, message: err.message });
    }
  }

  async getSalaryHistory(req, res) {
    try {
      const { employeeId } = req.params;
      const result = await payrollService.getEmployeeSalaryHistory(
        req.user.organizationId,
        employeeId,
      );
      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      return res
        .status(err.statusCode || 500)
        .json({ success: false, message: err.message });
    }
  }

  async recordSalaryRevision(req, res) {
    try {
      const result = await payrollService.recordSalaryRevision(
        req.user.organizationId,
        req.body,
        req.user.id,
      );
      return res
        .status(201)
        .json({
          success: true,
          message: "Salary revision recorded successfully",
          data: result,
        });
    } catch (err) {
      return res
        .status(err.statusCode || 400)
        .json({ success: false, message: err.message });
    }
  }
}

module.exports = new PayrollController();
