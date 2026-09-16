const expenseService = require("../services/expense.service");
const { uploadBuffer } = require("../config/cloudinary");
const prisma = require("../config/database");

class ExpenseController {
  /**
   * Submit an Expense Claim
   */
  async createClaim(req, res, next) {
    try {
      const organizationId = req.user.organizationId;
      let employeeId = req.body.employeeId;

      // If employeeId not explicitly passed, look up from logged-in user
      if (!employeeId) {
        const emp = await prisma.employee.findFirst({
          where: { userId: req.user.id, organizationId },
        });
        if (emp) {
          employeeId = emp.id;
        }
      }

      if (!employeeId) {
        return res.status(400).json({
          success: false,
          message: "Employee profile not found for this user account.",
        });
      }

      // Handle direct file upload via multer if present
      let receiptUrl = req.body.receiptUrl;
      let receiptPublicId = null;

      if (req.file) {
        try {
          const uploadRes = await uploadBuffer(req.file.buffer, {
            folder: `workpulse/expenses/${organizationId}`,
            resource_type: "auto",
          });
          receiptUrl = uploadRes.secure_url;
          receiptPublicId = uploadRes.public_id;
        } catch (uploadErr) {
          console.warn("Cloudinary multer upload error:", uploadErr.message);
        }
      }

      const claim = await expenseService.createExpenseClaim(organizationId, employeeId, {
        ...req.body,
        receiptUrl,
        receiptPublicId,
      });

      return res.status(201).json({
        success: true,
        message: "Expense claim submitted successfully.",
        data: claim,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * List all claims for Organization (HR / Manager)
   */
  async listOrganizationClaims(req, res, next) {
    try {
      const organizationId = req.user.organizationId;
      const claims = await expenseService.getOrganizationExpenses(organizationId, req.query);

      return res.status(200).json({
        success: true,
        data: claims,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * List logged-in employee's own claims
   */
  async listMyClaims(req, res, next) {
    try {
      const organizationId = req.user.organizationId;
      const employee = await prisma.employee.findFirst({
        where: { userId: req.user.id, organizationId },
      });

      if (!employee) {
        return res.status(200).json({
          success: true,
          data: [],
        });
      }

      const claims = await expenseService.getEmployeeExpenses(organizationId, employee.id, req.query);

      return res.status(200).json({
        success: true,
        data: claims,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Review claim (Approve or Reject)
   */
  async reviewClaim(req, res, next) {
    try {
      const organizationId = req.user.organizationId;
      const claimId = req.params.id;
      const reviewerUserId = req.user.id;

      const updated = await expenseService.reviewExpenseClaim(
        organizationId,
        claimId,
        reviewerUserId,
        req.body
      );

      return res.status(200).json({
        success: true,
        message: `Claim ${req.body.status.toLowerCase()} successfully.`,
        data: updated,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Delete pending claim
   */
  async deleteClaim(req, res, next) {
    try {
      const organizationId = req.user.organizationId;
      const claimId = req.params.id;

      const employee = await prisma.employee.findFirst({
        where: { userId: req.user.id, organizationId },
      });

      if (!employee) {
        return res.status(404).json({ success: false, message: "Employee record not found." });
      }

      const result = await expenseService.deleteExpenseClaim(organizationId, employee.id, claimId);
      return res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Summary KPIs for claims
   */
  async getSummary(req, res, next) {
    try {
      const organizationId = req.user.organizationId;
      const summary = await expenseService.getExpenseSummary(organizationId, req.query);

      return res.status(200).json({
        success: true,
        data: summary,
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new ExpenseController();
