const payrollService = require("../services/payroll.service");

class PayrollController {
  async upsertSalaryStructure(req, res) {
    try {
      const result = await payrollService.upsertSalaryStructure(req.user.organizationId, req.body);
      return res.status(200).json({ success: true, message: "Salary structure updated", data: result });
    } catch (err) {
      return res.status(err.statusCode || 400).json({ success: false, message: err.message });
    }
  }

  async getSalaryStructure(req, res) {
    try {
      const { employeeId } = req.params;
      const result = await payrollService.getSalaryStructure(req.user.organizationId, employeeId);
      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      return res.status(err.statusCode || 500).json({ success: false, message: err.message });
    }
  }

  async calculate(req, res) {
    try {
      const { employeeId, month, year } = req.query;
      if (!employeeId || !month || !year) {
        return res.status(400).json({ success: false, message: "employeeId, month, and year are required" });
      }
      const result = await payrollService.calculateEmployeePayroll(req.user.organizationId, employeeId, month, year);
      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      return res.status(err.statusCode || 400).json({ success: false, message: err.message });
    }
  }

  async generate(req, res) {
    try {
      const { month, year } = req.body;
      if (!month || !year) {
        return res.status(400).json({ success: false, message: "month and year are required" });
      }
      const result = await payrollService.generateOrganizationPayslips(req.user.organizationId, month, year);
      return res.status(201).json({ success: true, message: "Payslips generated successfully", data: result });
    } catch (err) {
      return res.status(err.statusCode || 400).json({ success: false, message: err.message });
    }
  }

  async getPayslips(req, res) {
    try {
      const result = await payrollService.getPayslips(req.user.organizationId, req.query);
      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      return res.status(err.statusCode || 500).json({ success: false, message: err.message });
    }
  }

  async getMyPayslips(req, res) {
    try {
      const result = await payrollService.getMyPayslips(req.user.id, req.user.organizationId);
      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      return res.status(err.statusCode || 500).json({ success: false, message: err.message });
    }
  }

  async approveBatch(req, res) {
    try {
      const { month, year, remarks } = req.body;
      if (!month || !year) {
        return res.status(400).json({ success: false, message: "month and year are required" });
      }
      const result = await payrollService.approvePayrollBatch(
        req.user.organizationId,
        month,
        year,
        req.user.id,
        remarks
      );
      return res.status(200).json({ success: true, message: `Payroll batch approved for ${month}/${year}`, data: result });
    } catch (err) {
      return res.status(err.statusCode || 400).json({ success: false, message: err.message });
    }
  }

  async disburseBatch(req, res) {
    try {
      const { month, year, remarks } = req.body;
      if (!month || !year) {
        return res.status(400).json({ success: false, message: "month and year are required" });
      }
      const result = await payrollService.disbursePayrollBatch(
        req.user.organizationId,
        month,
        year,
        req.user.id,
        remarks
      );
      return res.status(200).json({ success: true, message: `Payroll batch marked as disbursed for ${month}/${year}`, data: result });
    } catch (err) {
      return res.status(err.statusCode || 400).json({ success: false, message: err.message });
    }
  }

  async updateStatus(req, res) {
    try {
      const { id } = req.params;
      const { status, remarks } = req.body;
      if (!status) {
        return res.status(400).json({ success: false, message: "status is required" });
      }
      const result = await payrollService.updatePayslipStatus(
        req.user.organizationId,
        id,
        status,
        req.user.id,
        remarks
      );
      return res.status(200).json({ success: true, message: "Payslip status updated", data: result });
    } catch (err) {
      return res.status(err.statusCode || 400).json({ success: false, message: err.message });
    }
  }

  async getPayslipDetails(req, res) {
    try {
      const { id } = req.params;
      const result = await payrollService.getPayslipDetails(req.user.organizationId, id);
      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      return res.status(err.statusCode || 500).json({ success: false, message: err.message });
    }
  }

  async getReports(req, res) {
    try {
      const { month, year } = req.query;
      if (!month || !year) {
        return res.status(400).json({ success: false, message: "month and year query parameters are required" });
      }
      const result = await payrollService.getPayrollReports(req.user.organizationId, month, year);
      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      return res.status(err.statusCode || 500).json({ success: false, message: err.message });
    }
  }

  async getSalaryHistory(req, res) {
    try {
      const { employeeId } = req.params;
      const result = await payrollService.getEmployeeSalaryHistory(req.user.organizationId, employeeId);
      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      return res.status(err.statusCode || 500).json({ success: false, message: err.message });
    }
  }

  async recordSalaryRevision(req, res) {
    try {
      const result = await payrollService.recordSalaryRevision(req.user.organizationId, req.body, req.user.id);
      return res.status(201).json({ success: true, message: "Salary revision recorded successfully", data: result });
    } catch (err) {
      return res.status(err.statusCode || 400).json({ success: false, message: err.message });
    }
  }
}

module.exports = new PayrollController();
