const employeeDocumentService = require("../services/employee-document.service");

class EmployeeDocumentController {
  /**
   * Helper to verify employee access permissions
   */
  _canAccessEmployee(req, targetEmployeeId) {
    const { role, employee } = req.user;
    if (["SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"].includes(role)) {
      return true;
    }
    return employee && employee.id === targetEmployeeId;
  }

  /**
   * GET /api/employees/:employeeId/documents
   * Also supports :employeeId = "me"
   */
  async getDocuments(req, res, next) {
    try {
      let targetEmployeeId = req.params.employeeId;
      if (targetEmployeeId === "me") {
        if (!req.user.employee) {
          return res.status(404).json({ success: false, message: "No employee profile linked to current user" });
        }
        targetEmployeeId = req.user.employee.id;
      }

      if (!this._canAccessEmployee(req, targetEmployeeId)) {
        return res.status(403).json({ success: false, message: "Unauthorized to access these documents" });
      }

      const data = await employeeDocumentService.getEmployeeDocuments(
        req.user.organizationId,
        targetEmployeeId
      );

      return res.status(200).json({
        success: true,
        data,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/employees/:employeeId/documents
   * Upload / Add Document
   */
  async uploadDocument(req, res, next) {
    try {
      let targetEmployeeId = req.params.employeeId;
      if (targetEmployeeId === "me") {
        if (!req.user.employee) {
          return res.status(404).json({ success: false, message: "No employee profile linked to current user" });
        }
        targetEmployeeId = req.user.employee.id;
      }

      if (!this._canAccessEmployee(req, targetEmployeeId)) {
        return res.status(403).json({ success: false, message: "Unauthorized to upload documents for this employee" });
      }

      const fileBuffer = req.file ? req.file.buffer : null;
      const payload = {
        ...req.body,
        fileName: req.file ? req.file.originalname : req.body.fileName,
        mimeType: req.file ? req.file.mimetype : req.body.mimeType,
        fileSize: req.file ? req.file.size : req.body.fileSize,
      };

      const doc = await employeeDocumentService.uploadEmployeeDocument(
        req.user.organizationId,
        targetEmployeeId,
        payload,
        fileBuffer,
        req.user
      );

      return res.status(201).json({
        success: true,
        message: "Document uploaded successfully",
        data: doc,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /api/employees/:employeeId/documents/:documentId
   * Replace or update document metadata
   */
  async replaceOrUpdateDocument(req, res, next) {
    try {
      let targetEmployeeId = req.params.employeeId;
      if (targetEmployeeId === "me") {
        if (!req.user.employee) {
          return res.status(404).json({ success: false, message: "No employee profile linked" });
        }
        targetEmployeeId = req.user.employee.id;
      }

      if (!this._canAccessEmployee(req, targetEmployeeId)) {
        return res.status(403).json({ success: false, message: "Unauthorized to update this document" });
      }

      const fileBuffer = req.file ? req.file.buffer : null;
      const payload = {
        ...req.body,
        fileName: req.file ? req.file.originalname : req.body.fileName,
        mimeType: req.file ? req.file.mimetype : req.body.mimeType,
        fileSize: req.file ? req.file.size : req.body.fileSize,
      };

      const doc = await employeeDocumentService.replaceOrUpdateDocument(
        req.user.organizationId,
        targetEmployeeId,
        req.params.documentId,
        payload,
        fileBuffer,
        req.user
      );

      return res.status(200).json({
        success: true,
        message: "Document updated successfully",
        data: doc,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /api/employees/:employeeId/documents/:documentId
   */
  async deleteDocument(req, res, next) {
    try {
      let targetEmployeeId = req.params.employeeId;
      if (targetEmployeeId === "me") {
        if (!req.user.employee) {
          return res.status(404).json({ success: false, message: "No employee profile linked" });
        }
        targetEmployeeId = req.user.employee.id;
      }

      if (!this._canAccessEmployee(req, targetEmployeeId)) {
        return res.status(403).json({ success: false, message: "Unauthorized to delete this document" });
      }

      const result = await employeeDocumentService.deleteDocument(
        req.user.organizationId,
        targetEmployeeId,
        req.params.documentId
      );

      return res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/employees/:employeeId/documents/:documentId/verify
   * Admin / Manager only
   */
  async verifyDocument(req, res, next) {
    try {
      const { status, rejectionReason } = req.body;
      const reviewerName = req.user.employee
        ? `${req.user.employee.firstName} ${req.user.employee.lastName || ""}`.trim()
        : req.user.email;

      const doc = await employeeDocumentService.verifyDocument(
        req.user.organizationId,
        req.params.employeeId,
        req.params.documentId,
        {
          status,
          rejectionReason,
          reviewerName,
          reviewerId: req.user.id,
        }
      );

      return res.status(200).json({
        success: true,
        message: `Document status updated to ${status}`,
        data: doc,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/employees/:employeeId/documents/:documentId/remind-expiry
   */
  async sendExpiryReminder(req, res, next) {
    try {
      const result = await employeeDocumentService.sendExpiryReminder(
        req.user.organizationId,
        req.params.employeeId,
        req.params.documentId
      );

      return res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
}

const controller = new EmployeeDocumentController();
// Bind methods to controller instance
controller.getDocuments = controller.getDocuments.bind(controller);
controller.uploadDocument = controller.uploadDocument.bind(controller);
controller.replaceOrUpdateDocument = controller.replaceOrUpdateDocument.bind(controller);
controller.deleteDocument = controller.deleteDocument.bind(controller);
controller.verifyDocument = controller.verifyDocument.bind(controller);
controller.sendExpiryReminder = controller.sendExpiryReminder.bind(controller);

module.exports = controller;
