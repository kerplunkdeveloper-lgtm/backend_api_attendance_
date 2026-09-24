const expenseService = require("../services/expense.service");
const { uploadBuffer } = require("../config/cloudinary");
const { assertSniffedType } = require("../middleware/upload.middleware");
const prisma = require("../config/database");

class ExpenseController {
  /**
   * Submit an Expense Claim
   */
  async createClaim(req, res, next) {
    try {
      const organizationId = req.user.organizationId;
      const isAdmin = ["SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"].includes(
        req.user.role,
      );

      // Filing on someone else's behalf is an approver action. An employee who
      // supplies a colleague's id is refused rather than silently redirected.
      let employeeId = isAdmin ? req.body.employeeId : null;

      if (!employeeId) {
        let emp = await prisma.employee.findFirst({
          where: { userId: req.user.id, organizationId },
        });

        if (
          emp &&
          req.body.employeeId &&
          req.body.employeeId !== emp.id &&
          !isAdmin
        ) {
          return res.status(403).json({
            success: false,
            message: "You cannot submit an expense claim for another employee.",
          });
        }

        if (!emp && isAdmin) {
          // If admin doesn't have an employee record yet, auto-provision one
          emp = await prisma.employee.create({
            data: {
              organizationId,
              userId: req.user.id,
              employeeCode: `ADM-${Date.now().toString().slice(-4)}`,
              firstName: req.user.email?.split("@")[0] || "Admin",
              status: "ACTIVE",
            },
          });
        }

        if (emp) employeeId = emp.id;
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
        assertSniffedType(req.file);
        try {
          const uploadRes = await uploadBuffer(req.file.buffer, {
            folder: `workpulse/${organizationId}/receipts`,
            resource_type: "auto",
          });
          receiptUrl = uploadRes.secure_url;
          receiptPublicId = uploadRes.public_id;
        } catch (uploadErr) {
          // Surfaced rather than swallowed: a claim saved without the receipt
          // the user attached looks successful but fails review later.
          return res.status(502).json({
            success: false,
            message: `Receipt upload failed: ${uploadErr.message}. The claim was not submitted.`,
          });
        }
      }

      const claim = await expenseService.createExpenseClaim(
        organizationId,
        employeeId,
        {
          ...req.body,
          receiptUrl,
          receiptPublicId,
        },
      );

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
      const isAdmin = ["SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"].includes(req.user.role);

      // If called by regular employee, safely return their own claims
      if (!isAdmin) {
        return this.listMyClaims(req, res, next);
      }

      const claims = await expenseService.getOrganizationExpenses(
        organizationId,
        req.query,
      );

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

      const claims = await expenseService.getEmployeeExpenses(
        organizationId,
        employee.id,
        req.query,
      );

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
        {
          ...req.body,
          reviewerRole: req.user.role,
        },
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
      const isAdmin = ["SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"].includes(req.user.role);

      let employeeId = null;
      if (!isAdmin) {
        const employee = await prisma.employee.findFirst({
          where: { userId: req.user.id, organizationId },
        });

        if (!employee) {
          return res
            .status(404)
            .json({ success: false, message: "Employee record not found." });
        }
        employeeId = employee.id;
      }

      const result = await expenseService.deleteExpenseClaim(
        organizationId,
        employeeId,
        claimId,
        isAdmin,
      );
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
      const summary = await expenseService.getExpenseSummary(
        organizationId,
        req.query,
      );

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
