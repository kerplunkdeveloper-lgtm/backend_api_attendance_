const prisma = require("../config/database");
const { uploadImage, uploadBuffer } = require("../config/cloudinary");
const notificationService = require("./notification.service");

const DOCUMENT_DEFINITIONS = [
  { type: "AADHAAR", label: "Aadhaar Card", description: "Government 12-digit Unique Identification document", isMandatory: true, hasExpiry: false },
  { type: "PAN", label: "PAN Card", description: "Income Tax Permanent Account Number card", isMandatory: true, hasExpiry: false },
  { type: "PASSPORT", label: "Passport", description: "Passport bio page with valid dates", isMandatory: false, hasExpiry: true },
  { type: "DRIVING_LICENCE", label: "Driving Licence", description: "State transport vehicle driving license", isMandatory: false, hasExpiry: true },
  { type: "EDUCATION_CERTIFICATE", label: "Education Certificate", description: "Highest qualification degree / graduation marksheets", isMandatory: true, hasExpiry: false },
  { type: "EXPERIENCE_LETTER", label: "Experience / Relieving Letter", description: "Previous employer relieving or work experience certificate", isMandatory: false, hasExpiry: false },
  { type: "OFFER_LETTER", label: "Offer Letter", description: "Official signed offer of employment letter", isMandatory: false, hasExpiry: false },
  { type: "EMPLOYMENT_CONTRACT", label: "Employment Contract", description: "Executed employment agreement / NDA contract", isMandatory: false, hasExpiry: true },
  { type: "BANK_DOCUMENT", label: "Bank Document", description: "Bank passbook front page or cancelled cheque for salary credits", isMandatory: true, hasExpiry: false },
  { type: "OTHER", label: "Other Document", description: "Additional certifications, police verification, or medical reports", isMandatory: false, hasExpiry: false },
];

class EmployeeDocumentService {
  /**
   * Get all documents for an employee + checklist status
   */
  async getEmployeeDocuments(organizationId, employeeId) {
    const employee = await prisma.employee.findFirst({
      where: { id: employeeId, organizationId },
      include: {
        user: { select: { id: true, email: true, role: true } },
        department: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } },
      },
    });

    if (!employee) {
      const error = new Error("Employee not found in organization");
      error.statusCode = 404;
      throw error;
    }

    const documents = await prisma.employeeDocument.findMany({
      where: { employeeId, organizationId },
      orderBy: [{ createdAt: "desc" }],
    });

    const now = new Date();

    // Map documents with enhanced calculated statuses (expiring soon, expired, etc.)
    const enrichedDocuments = documents.map((doc) => {
      let isExpired = false;
      let isExpiringSoon = false;
      let daysUntilExpiry = null;

      if (doc.expiryDate) {
        const expDate = new Date(doc.expiryDate);
        const diffTime = expDate.getTime() - now.getTime();
        daysUntilExpiry = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        if (daysUntilExpiry < 0) {
          isExpired = true;
        } else if (daysUntilExpiry <= 30) {
          isExpiringSoon = true;
        }
      }

      return {
        ...doc,
        isExpired,
        isExpiringSoon,
        daysUntilExpiry,
      };
    });

    // Check checklist completion
    const checklist = DOCUMENT_DEFINITIONS.map((def) => {
      const matchingDocs = enrichedDocuments.filter((d) => d.documentType === def.type);
      const isUploaded = matchingDocs.length > 0;
      const isVerified = matchingDocs.some((d) => d.status === "VERIFIED");
      const hasPending = matchingDocs.some((d) => d.status === "PENDING");
      const hasRejected = matchingDocs.some((d) => d.status === "REJECTED");

      return {
        ...def,
        isUploaded,
        isVerified,
        status: isVerified ? "VERIFIED" : hasPending ? "PENDING" : hasRejected ? "REJECTED" : isUploaded ? "UPLOADED" : "MISSING",
        uploadedCount: matchingDocs.length,
        latestDocument: matchingDocs[0] || null,
      };
    });

    const totalMandatory = checklist.filter((c) => c.isMandatory).length;
    const uploadedMandatory = checklist.filter((c) => c.isMandatory && c.isUploaded).length;
    const verifiedMandatory = checklist.filter((c) => c.isMandatory && c.isVerified).length;
    const completionPercentage = totalMandatory > 0 ? Math.round((uploadedMandatory / totalMandatory) * 100) : 100;

    return {
      employee: {
        id: employee.id,
        employeeCode: employee.employeeCode,
        firstName: employee.firstName,
        lastName: employee.lastName,
        name: `${employee.firstName} ${employee.lastName || ""}`.trim(),
        email: employee.user?.email || null,
        department: employee.department?.name || "-",
        branch: employee.branch?.name || "-",
      },
      summary: {
        totalDocuments: enrichedDocuments.length,
        verifiedCount: enrichedDocuments.filter((d) => d.status === "VERIFIED").length,
        pendingCount: enrichedDocuments.filter((d) => d.status === "PENDING").length,
        rejectedCount: enrichedDocuments.filter((d) => d.status === "REJECTED").length,
        expiredCount: enrichedDocuments.filter((d) => d.isExpired).length,
        expiringSoonCount: enrichedDocuments.filter((d) => d.isExpiringSoon).length,
        completionPercentage,
        totalMandatory,
        uploadedMandatory,
        verifiedMandatory,
      },
      checklist,
      documents: enrichedDocuments,
    };
  }

  /**
   * Upload or add a new employee document
   */
  async uploadEmployeeDocument(organizationId, employeeId, payload, fileBuffer, uploadedByUser) {
    const employee = await prisma.employee.findFirst({
      where: { id: employeeId, organizationId },
      include: { user: true },
    });

    if (!employee) {
      const error = new Error("Employee not found");
      error.statusCode = 404;
      throw error;
    }

    const {
      documentType,
      title,
      fileName,
      fileUrl: rawFileUrl,
      fileSize,
      mimeType,
      expiryDate,
    } = payload;

    if (!documentType) {
      const error = new Error("documentType is required");
      error.statusCode = 400;
      throw error;
    }

    const validTypes = DOCUMENT_DEFINITIONS.map((d) => d.type);
    if (!validTypes.includes(documentType)) {
      const error = new Error(`Invalid documentType. Allowed values: ${validTypes.join(", ")}`);
      error.statusCode = 400;
      throw error;
    }

    let finalFileUrl = rawFileUrl;
    let computedFileName = fileName || `${documentType.toLowerCase()}_doc`;
    let computedMimeType = mimeType || "application/octet-stream";
    let computedFileSize = fileSize ? Number(fileSize) : null;

    // 1. If a direct fileBuffer was provided via multer
    if (fileBuffer) {
      try {
        const uploadRes = await uploadBuffer(fileBuffer, {
          folder: `workpulse/employees/${employeeId}/documents`,
          resource_type: "auto",
        });
        if (uploadRes && uploadRes.secure_url) {
          finalFileUrl = uploadRes.secure_url;
          computedFileSize = uploadRes.bytes || computedFileSize;
        }
      } catch (err) {
        console.error("Cloudinary buffer upload error:", err.message);
      }
    }
    // 2. If base64 data URI was passed in payload
    else if (finalFileUrl && typeof finalFileUrl === "string" && finalFileUrl.startsWith("data:")) {
      try {
        const uploadRes = await uploadImage(finalFileUrl, {
          folder: `workpulse/employees/${employeeId}/documents`,
          resource_type: "auto",
        });
        if (uploadRes && uploadRes.secure_url) {
          finalFileUrl = uploadRes.secure_url;
          computedFileSize = uploadRes.bytes || computedFileSize;
        }
      } catch (err) {
        console.error("Cloudinary base64 upload error:", err.message);
      }
    }

    if (!finalFileUrl) {
      const error = new Error("fileUrl or uploaded file is required");
      error.statusCode = 400;
      throw error;
    }

    const newDoc = await prisma.employeeDocument.create({
      data: {
        organizationId,
        employeeId,
        documentType,
        title: title ? title.trim() : null,
        fileName: computedFileName.trim(),
        fileUrl: finalFileUrl.trim(),
        fileSize: computedFileSize,
        mimeType: computedMimeType,
        status: "PENDING",
        expiryDate: expiryDate ? new Date(expiryDate) : null,
      },
    });

    // Notify Admins or HR if uploaded by an employee
    if (uploadedByUser && uploadedByUser.role === "EMPLOYEE") {
      try {
        const admins = await prisma.user.findMany({
          where: {
            organizationId,
            role: { in: ["SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"] },
          },
          select: { id: true },
        });

        for (const admin of admins) {
          await notificationService.createNotification({
            organizationId,
            userId: admin.id,
            title: "New Employee Document Uploaded",
            message: `${employee.firstName} uploaded a new document (${documentType.replace(/_/g, " ")}) awaiting verification.`,
            type: "SYSTEM",
          });
        }
      } catch (notifErr) {
        console.warn("Failed to dispatch admin notification for document upload:", notifErr.message);
      }
    }

    return newDoc;
  }

  /**
   * Replace or update an existing document
   */
  async replaceOrUpdateDocument(organizationId, employeeId, documentId, payload, fileBuffer, updatedByUser) {
    const existing = await prisma.employeeDocument.findFirst({
      where: { id: documentId, employeeId, organizationId },
    });

    if (!existing) {
      const error = new Error("Document not found");
      error.statusCode = 404;
      throw error;
    }

    const {
      title,
      fileName,
      fileUrl: rawFileUrl,
      fileSize,
      mimeType,
      expiryDate,
      resetVerification = true,
    } = payload;

    let finalFileUrl = existing.fileUrl;
    let computedFileName = fileName || existing.fileName;
    let computedMimeType = mimeType || existing.mimeType;
    let computedFileSize = fileSize !== undefined ? Number(fileSize) : existing.fileSize;

    // Handle replace file
    if (fileBuffer) {
      try {
        const uploadRes = await uploadBuffer(fileBuffer, {
          folder: `workpulse/employees/${employeeId}/documents`,
          resource_type: "auto",
        });
        if (uploadRes && uploadRes.secure_url) {
          finalFileUrl = uploadRes.secure_url;
          computedFileSize = uploadRes.bytes || computedFileSize;
        }
      } catch (err) {
        console.error("Cloudinary buffer replacement error:", err.message);
      }
    } else if (rawFileUrl && typeof rawFileUrl === "string" && rawFileUrl.startsWith("data:")) {
      try {
        const uploadRes = await uploadImage(rawFileUrl, {
          folder: `workpulse/employees/${employeeId}/documents`,
          resource_type: "auto",
        });
        if (uploadRes && uploadRes.secure_url) {
          finalFileUrl = uploadRes.secure_url;
          computedFileSize = uploadRes.bytes || computedFileSize;
        }
      } catch (err) {
        console.error("Cloudinary base64 replacement error:", err.message);
      }
    } else if (rawFileUrl && typeof rawFileUrl === "string") {
      finalFileUrl = rawFileUrl.trim();
    }

    const updateData = {
      fileName: computedFileName,
      fileUrl: finalFileUrl,
      fileSize: computedFileSize,
      mimeType: computedMimeType,
      updatedAt: new Date(),
    };

    if (title !== undefined) updateData.title = title ? title.trim() : null;
    if (expiryDate !== undefined) updateData.expiryDate = expiryDate ? new Date(expiryDate) : null;

    // If file was replaced, reset status to PENDING for HR review
    if (resetVerification && (fileBuffer || (rawFileUrl && rawFileUrl !== existing.fileUrl))) {
      updateData.status = "PENDING";
      updateData.rejectionReason = null;
      updateData.verifiedBy = null;
      updateData.verifiedAt = null;
    }

    const updated = await prisma.employeeDocument.update({
      where: { id: documentId },
      data: updateData,
    });

    return updated;
  }

  /**
   * Delete an employee document
   */
  async deleteDocument(organizationId, employeeId, documentId) {
    const existing = await prisma.employeeDocument.findFirst({
      where: { id: documentId, employeeId, organizationId },
    });

    if (!existing) {
      const error = new Error("Document not found");
      error.statusCode = 404;
      throw error;
    }

    await prisma.employeeDocument.delete({
      where: { id: documentId },
    });

    return { success: true, message: "Document deleted successfully" };
  }

  /**
   * HR / Admin: Verify or Reject Document
   */
  async verifyDocument(organizationId, employeeId, documentId, { status, rejectionReason, reviewerName, reviewerId }) {
    if (!["VERIFIED", "REJECTED", "PENDING"].includes(status)) {
      const error = new Error("Status must be VERIFIED, REJECTED, or PENDING");
      error.statusCode = 400;
      throw error;
    }

    const existing = await prisma.employeeDocument.findFirst({
      where: { id: documentId, employeeId, organizationId },
      include: {
        employee: {
          include: { user: true },
        },
      },
    });

    if (!existing) {
      const error = new Error("Document not found");
      error.statusCode = 404;
      throw error;
    }

    const updated = await prisma.employeeDocument.update({
      where: { id: documentId },
      data: {
        status,
        rejectionReason: status === "REJECTED" ? (rejectionReason ? rejectionReason.trim() : "Document rejected by HR") : null,
        verifiedBy: status === "VERIFIED" ? (reviewerName || "HR Admin") : null,
        verifiedAt: status === "VERIFIED" ? new Date() : null,
      },
    });

    // Notify employee of verification outcome
    if (existing.employee?.user?.id) {
      const notifTitle = status === "VERIFIED" ? "Document Verified" : status === "REJECTED" ? "Document Rejected" : "Document Under Review";
      const notifMessage =
        status === "VERIFIED"
          ? `Your ${existing.documentType.replace(/_/g, " ")} document has been verified and approved.`
          : status === "REJECTED"
          ? `Your ${existing.documentType.replace(/_/g, " ")} document was rejected. Reason: ${rejectionReason || "Please re-upload a clear copy."}`
          : `Your ${existing.documentType.replace(/_/g, " ")} status was set to pending.`;

      try {
        await notificationService.createNotification({
          organizationId,
          userId: existing.employee.user.id,
          title: notifTitle,
          message: notifMessage,
          type: "SYSTEM",
        });
      } catch (err) {
        console.warn("Failed to notify employee:", err.message);
      }
    }

    return updated;
  }

  /**
   * Send document expiry reminder (manual trigger or cron trigger)
   */
  async sendExpiryReminder(organizationId, employeeId, documentId) {
    const doc = await prisma.employeeDocument.findFirst({
      where: { id: documentId, employeeId, organizationId },
      include: {
        employee: { include: { user: true } },
      },
    });

    if (!doc) {
      const error = new Error("Document not found");
      error.statusCode = 404;
      throw error;
    }

    if (!doc.expiryDate) {
      const error = new Error("Document has no expiry date set");
      error.statusCode = 400;
      throw error;
    }

    const expDate = new Date(doc.expiryDate);
    const dateFormatted = expDate.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

    // Mark reminder as sent
    await prisma.employeeDocument.update({
      where: { id: documentId },
      data: { expiryReminderSent: true },
    });

    // Send notification to employee
    if (doc.employee?.user?.id) {
      await notificationService.createNotification({
        organizationId,
        userId: doc.employee.user.id,
        title: "⚠️ Document Expiry Reminder",
        message: `Your ${doc.documentType.replace(/_/g, " ")} document expires on ${dateFormatted}. Please submit an updated renewal copy to avoid compliance flags.`,
        type: "SYSTEM",
      });
    }

    return { success: true, message: `Expiry reminder sent for ${doc.documentType} (Expires: ${dateFormatted})` };
  }
}

module.exports = new EmployeeDocumentService();
