const prisma = require("../config/database");

const {
  uploadImage,
  uploadBuffer,
  signedDeliveryUrl,
  isSensitiveDocumentType,
} = require("../config/cloudinary");

const notificationService = require("./notification.service");

const {
  assertSniffedType,
} = require("../middleware/upload.middleware");

const { WORKING_STATUSES } = require("../utils/employeeStatus");

const {
  getFileContent,
  uploadBuffer: uploadToS3,
  deleteObject: deleteFromS3,
} = require("../config/s3");

// --------------------------------------------------
// Helpers
// --------------------------------------------------

function httpError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function uploadFailure(message, cause) {
  const error = httpError(message, 502);
  error.cause = cause;
  return error;
}

function trustedCloudinaryUrl(value) {
  try {
    const url = new URL(String(value));

    if (
      url.protocol !== "https:" ||
      !/(^|\.)cloudinary\.com$/i.test(url.hostname)
    ) {
      throw new Error("Untrusted Cloudinary host");
    }

    return url.toString();
  } catch {
    throw httpError(
      "Document URL must use HTTPS Cloudinary storage.",
      400
    );
  }
}

function documentForResponse(document) {
  if (!document) return document;

  const { storageKey, ...safe } = document;

  return {
    ...safe,
    fileUrl:
      document.storageProvider === "s3"
        ? null
        : document.fileUrl,
  };
}

async function cleanupS3(
  storageKey,
  organizationId,
  reason
) {
  if (!storageKey) return;

  try {
    await deleteFromS3(storageKey, organizationId);
  } catch (error) {
    console.error("[S3] Cleanup failed:", {
      reason,
      storageKey,
      message: error.message,
    });
  }
}

// --------------------------------------------------
// Document definitions
// --------------------------------------------------

const DOCUMENT_DEFINITIONS = [
  {
    type: "AADHAAR",
    label: "Aadhaar Card",
    description: "Government identification document",
    isMandatory: true,
    hasExpiry: false,
  },
  {
    type: "PAN",
    label: "PAN Card",
    description: "Income Tax PAN document",
    isMandatory: true,
    hasExpiry: false,
  },
  {
    type: "PASSPORT",
    label: "Passport",
    description: "Passport identification document",
    isMandatory: false,
    hasExpiry: true,
  },
  {
    type: "DRIVING_LICENCE",
    label: "Driving Licence",
    description: "Driving licence document",
    isMandatory: false,
    hasExpiry: true,
  },
  {
    type: "EDUCATION_CERTIFICATE",
    label: "Education Certificate",
    description: "Educational qualification document",
    isMandatory: true,
    hasExpiry: false,
  },
  {
    type: "EXPERIENCE_LETTER",
    label: "Experience / Relieving Letter",
    description: "Previous employment document",
    isMandatory: false,
    hasExpiry: false,
  },
  {
    type: "OFFER_LETTER",
    label: "Offer Letter",
    description: "Employment offer letter",
    isMandatory: false,
    hasExpiry: false,
  },
  {
    type: "EMPLOYMENT_CONTRACT",
    label: "Employment Contract",
    description: "Signed employment contract",
    isMandatory: false,
    hasExpiry: true,
  },
  {
    type: "BANK_DOCUMENT",
    label: "Bank Document",
    description: "Bank passbook or cancelled cheque",
    isMandatory: true,
    hasExpiry: false,
  },
  {
    type: "OTHER",
    label: "Other Document",
    description: "Additional employee document",
    isMandatory: false,
    hasExpiry: false,
  },
];

// --------------------------------------------------
// Storage adapter
// --------------------------------------------------

async function storeDocument({
  organizationId,
  employeeId,
  documentType,
  fileBuffer,
  rawFileUrl,
  mimeType,
}) {
  const useS3 = process.env.STORAGE_PROVIDER === "s3";

  // AWS S3
  if (useS3) {
    if (!Buffer.isBuffer(fileBuffer) || !fileBuffer.length) {
      throw httpError(
        "S3 document uploads require a multipart file.",
        400
      );
    }

    assertSniffedType({
      buffer: fileBuffer,
      mimetype: mimeType,
    });

    let uploaded;

    try {
      uploaded = await uploadToS3(fileBuffer, {
        organizationId,
        folder: "documents",
        contentType: mimeType,
      });

      if (!uploaded?.bucket || !uploaded?.key) {
        throw new Error("S3 returned no bucket or key");
      }
    } catch (error) {
      throw uploadFailure(
        "S3 document upload failed. Please try again.",
        error
      );
    }

    return {
      fileUrl: `s3://${uploaded.bucket}/${uploaded.key}`,
      storageProvider: "s3",
      storageKey: uploaded.key,
      fileSize: uploaded.bytes,
    };
  }

  // Existing Cloudinary
  let result;

  if (fileBuffer) {
    assertSniffedType({
      buffer: fileBuffer,
      mimetype: mimeType,
    });

    try {
      result = await uploadBuffer(fileBuffer, {
        folder: `workpulse/employees/${employeeId}/documents`,
        resource_type: "auto",
        type: isSensitiveDocumentType(documentType)
          ? "authenticated"
          : "upload",
      });
    } catch (error) {
      throw uploadFailure(
        "Cloudinary document upload failed.",
        error
      );
    }
  } else if (
    typeof rawFileUrl === "string" &&
    rawFileUrl.startsWith("data:")
  ) {
    try {
      result = await uploadImage(rawFileUrl, {
        folder: `workpulse/employees/${employeeId}/documents`,
        resource_type: "auto",
        type: isSensitiveDocumentType(documentType)
          ? "authenticated"
          : "upload",
      });
    } catch (error) {
      throw uploadFailure(
        "Cloudinary document upload failed.",
        error
      );
    }
  } else if (rawFileUrl) {
    if (isSensitiveDocumentType(documentType)) {
      throw httpError(
        "Sensitive documents must be uploaded directly.",
        400
      );
    }

    return {
      fileUrl: trustedCloudinaryUrl(rawFileUrl),
      storageProvider: "cloudinary",
      storageKey: null,
      fileSize: null,
    };
  } else {
    throw httpError(
      "fileUrl or uploaded file is required.",
      400
    );
  }

  if (!result?.secure_url) {
    throw uploadFailure(
      "Cloudinary returned no document URL."
    );
  }

  return {
    fileUrl: result.secure_url,
    storageProvider: "cloudinary",
    storageKey: null,
    fileSize: result.bytes || null,
  };
}

// --------------------------------------------------
// Employee Document Service
// --------------------------------------------------

class EmployeeDocumentService {
  /** Dashboard-friendly mandatory-document compliance summary. */
  async getMissingDocumentsSummary(organizationId, { branchId, limit = 50 } = {}) {
    const employees = await prisma.employee.findMany({
      where: { organizationId, status: { in: WORKING_STATUSES }, ...(branchId ? { branchId: String(branchId) } : {}) },
      select: {
        id: true, employeeCode: true, firstName: true, lastName: true, branch: { select: { id: true, name: true } },
        documents: { select: { documentType: true, status: true } },
      },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    });
    const mandatory = DOCUMENT_DEFINITIONS.filter((definition) => definition.isMandatory);
    const rows = employees.map((employee) => {
      const missing = mandatory.filter((definition) => !employee.documents.some((doc) => doc.documentType === definition.type && doc.status === "VERIFIED"));
      const uploaded = mandatory.filter((definition) => employee.documents.some((doc) => doc.documentType === definition.type));
      return {
        employee: { id: employee.id, employeeCode: employee.employeeCode, firstName: employee.firstName, lastName: employee.lastName, branch: employee.branch },
        missing: missing.map((definition) => ({ type: definition.type, label: definition.label, reason: employee.documents.some((doc) => doc.documentType === definition.type && doc.status === "REJECTED") ? "REJECTED" : "MISSING" })),
        uploadedMandatory: uploaded.length,
        totalMandatory: mandatory.length,
        completionPercentage: mandatory.length ? Math.round((uploaded.length / mandatory.length) * 100) : 100,
      };
    }).filter((row) => row.missing.length > 0);
    const capped = rows.slice(0, Math.max(1, Math.min(Number(limit) || 50, 200)));
    return { summary: { employeesWithMissingDocuments: rows.length, totalEmployees: employees.length, totalMandatory: mandatory.length, returned: capped.length }, employees: capped };
  }

  /**
   * Get all documents for an employee + checklist status
   */
  // ----------------------------------------------
  // Get employee documents
  // ----------------------------------------------

  async getEmployeeDocuments(organizationId, employeeId) {
    const employee = await prisma.employee.findFirst({
      where: {
        id: employeeId,
        organizationId,
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            role: true,
          },
        },
        department: {
          select: {
            id: true,
            name: true,
          },
        },
        branch: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!employee) {
      throw httpError(
        "Employee not found in organization.",
        404
      );
    }

    const documents = await prisma.employeeDocument.findMany({
      where: {
        employeeId,
        organizationId,
      },
      orderBy: [
        {
          createdAt: "desc",
        },
      ],
    });

    const now = new Date();

    const enrichedDocuments = documents.map((doc) => {
      let isExpired = false;
      let isExpiringSoon = false;
      let daysUntilExpiry = null;

      if (doc.expiryDate) {
        const expiry = new Date(doc.expiryDate);

        const difference =
          expiry.getTime() - now.getTime();

        daysUntilExpiry = Math.ceil(
          difference / (1000 * 60 * 60 * 24)
        );

        if (daysUntilExpiry < 0) {
          isExpired = true;
        } else if (daysUntilExpiry <= 30) {
          isExpiringSoon = true;
        }
      }

      const safeDocument = documentForResponse(doc);

      return {
        ...safeDocument,

        fileUrl:
          doc.storageProvider === "s3"
            ? null
            : signedDeliveryUrl(doc.fileUrl, {
                ttlSeconds: 300,
                authenticated: isSensitiveDocumentType(
                  doc.documentType
                ),
              }),

        isExpired,
        isExpiringSoon,
        daysUntilExpiry,
      };
    });

    const checklist = DOCUMENT_DEFINITIONS.map((definition) => {
      const matchingDocs = enrichedDocuments.filter(
        (document) =>
          document.documentType === definition.type
      );

      const isUploaded = matchingDocs.length > 0;

      const isVerified = matchingDocs.some(
        (document) => document.status === "VERIFIED"
      );

      const hasPending = matchingDocs.some(
        (document) => document.status === "PENDING"
      );

      const hasRejected = matchingDocs.some(
        (document) => document.status === "REJECTED"
      );

      return {
        ...definition,
        isUploaded,
        isVerified,
        status: isVerified
          ? "VERIFIED"
          : hasPending
            ? "PENDING"
            : hasRejected
              ? "REJECTED"
              : isUploaded
                ? "UPLOADED"
                : "MISSING",
        uploadedCount: matchingDocs.length,
        latestDocument: matchingDocs[0] || null,
      };
    });

    const totalMandatory = checklist.filter(
      (item) => item.isMandatory
    ).length;

    const uploadedMandatory = checklist.filter(
      (item) => item.isMandatory && item.isUploaded
    ).length;

    const verifiedMandatory = checklist.filter(
      (item) => item.isMandatory && item.isVerified
    ).length;

    const completionPercentage =
      totalMandatory > 0
        ? Math.round(
            (uploadedMandatory / totalMandatory) * 100
          )
        : 100;

    return {
      employee: {
        id: employee.id,
        employeeCode: employee.employeeCode,
        firstName: employee.firstName,
        lastName: employee.lastName,
        name: `${employee.firstName} ${
          employee.lastName || ""
        }`.trim(),
        email: employee.user?.email || null,
        department: employee.department?.name || "-",
        branch: employee.branch?.name || "-",
      },

      summary: {
        totalDocuments: enrichedDocuments.length,
        verifiedCount: enrichedDocuments.filter(
          (doc) => doc.status === "VERIFIED"
        ).length,
        pendingCount: enrichedDocuments.filter(
          (doc) => doc.status === "PENDING"
        ).length,
        rejectedCount: enrichedDocuments.filter(
          (doc) => doc.status === "REJECTED"
        ).length,
        expiredCount: enrichedDocuments.filter(
          (doc) => doc.isExpired
        ).length,
        expiringSoonCount: enrichedDocuments.filter(
          (doc) => doc.isExpiringSoon
        ).length,
        completionPercentage,
        totalMandatory,
        uploadedMandatory,
        verifiedMandatory,
      },

      checklist,
      documents: enrichedDocuments,
    };
  }

  // ----------------------------------------------
  // Secure document content
  // ----------------------------------------------

  async getDocumentContent(
    organizationId,
    employeeId,
    documentId
  ) {
    const document = await prisma.employeeDocument.findFirst({
      where: {
        id: documentId,
        employeeId,
        organizationId,
      },
      select: {
        fileUrl: true,
        fileName: true,
        mimeType: true,
        storageProvider: true,
        storageKey: true,
      },
    });

    if (!document) {
      throw httpError("Document not found.", 404);
    }

    if (document.storageProvider === "s3") {
      if (!document.storageKey) {
        throw httpError(
          "S3 document storage key is missing.",
          500
        );
      }

      const result = await getFileContent(
        document.storageKey,
        organizationId
      );

      return {
        buffer: result.buffer,
        contentType:
          document.mimeType ||
          result.contentType ||
          "application/octet-stream",
        fileName: document.fileName,
      };
    }

    if (document.storageProvider !== "cloudinary") {
      throw httpError(
        "Unsupported document storage provider.",
        500
      );
    }

    const response = await fetch(
      signedDeliveryUrl(
        trustedCloudinaryUrl(document.fileUrl)
      )
    );

    if (!response.ok) {
      throw httpError(
        "Document storage could not be reached.",
        502
      );
    }

    return {
      buffer: Buffer.from(
        await response.arrayBuffer()
      ),
      contentType:
        response.headers.get("content-type") ||
        document.mimeType ||
        "application/octet-stream",
      fileName: document.fileName,
    };
  }

  // ----------------------------------------------
  // Upload employee document
  // ----------------------------------------------

  async uploadEmployeeDocument(
    organizationId,
    employeeId,
    payload,
    fileBuffer,
    uploadedByUser
  ) {
    const employee = await prisma.employee.findFirst({
      where: {
        id: employeeId,
        organizationId,
      },
      include: {
        user: true,
      },
    });

    if (!employee) {
      throw httpError("Employee not found.", 404);
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
      throw httpError("documentType is required.", 400);
    }

    const validTypes = DOCUMENT_DEFINITIONS.map(
      (definition) => definition.type
    );

    if (!validTypes.includes(documentType)) {
      throw httpError(
        `Invalid documentType. Allowed: ${validTypes.join(", ")}`,
        400
      );
    }

    const computedMimeType =
      mimeType || "application/octet-stream";

    const computedFileName =
      fileName || `${documentType.toLowerCase()}_doc`;

    const stored = await storeDocument({
      organizationId,
      employeeId,
      documentType,
      fileBuffer,
      rawFileUrl,
      mimeType: computedMimeType,
    });

    let newDocument;

    try {
      newDocument = await prisma.employeeDocument.create({
        data: {
          organizationId,
          employeeId,
          documentType,
          title: title ? title.trim() : null,
          fileName: computedFileName.trim(),
          fileUrl: stored.fileUrl,
          storageProvider: stored.storageProvider,
          storageKey: stored.storageKey,
          fileSize:
            stored.fileSize ??
            (fileSize ? Number(fileSize) : null),
          mimeType: computedMimeType,
          status: "PENDING",
          expiryDate: expiryDate
            ? new Date(expiryDate)
            : null,
        },
      });
    } catch (error) {
      if (stored.storageProvider === "s3") {
        await cleanupS3(
          stored.storageKey,
          organizationId,
          "Database create failed"
        );
      }

      throw error;
    }

    // Notify HR / admins after employee upload.
    if (
      uploadedByUser &&
      uploadedByUser.role === "EMPLOYEE"
    ) {
      try {
        const admins = await prisma.user.findMany({
          where: {
            organizationId,
            role: {
              in: [
                "SUPER_ADMIN",
                "COMPANY_ADMIN",
                "MANAGER",
                "HR",
              ],
            },
          },
          select: {
            id: true,
          },
        });

        for (const admin of admins) {
          await notificationService.createNotification({
            organizationId,
            userId: admin.id,
            title: "New Employee Document Uploaded",
            message: `${employee.firstName} uploaded a new document (${documentType.replace(
              /_/g,
              " "
            )}) awaiting verification.`,
            type: "SYSTEM",
          });
        }
      } catch (error) {
        console.warn(
          "Failed to notify admins:",
          error.message
        );
      }
    }

    return documentForResponse(newDocument);
  }

  // ----------------------------------------------
  // Replace or update document
  // ----------------------------------------------

  async replaceOrUpdateDocument(
    organizationId,
    employeeId,
    documentId,
    payload,
    fileBuffer,
    updatedByUser
  ) {
    const existing = await prisma.employeeDocument.findFirst({
      where: {
        id: documentId,
        employeeId,
        organizationId,
      },
    });

    if (!existing) {
      throw httpError("Document not found.", 404);
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

    const computedFileName =
      fileName || existing.fileName;

    const computedMimeType =
      mimeType ||
      existing.mimeType ||
      "application/octet-stream";

    const hasReplacement =
      Boolean(fileBuffer) ||
      (
        typeof rawFileUrl === "string" &&
        rawFileUrl.length > 0 &&
        rawFileUrl !== existing.fileUrl
      );

    let stored = null;

    if (hasReplacement) {
      stored = await storeDocument({
        organizationId,
        employeeId,
        documentType: existing.documentType,
        fileBuffer,
        rawFileUrl,
        mimeType: computedMimeType,
      });
    }

    const updateData = {
      fileName: computedFileName,
      fileSize:
        stored?.fileSize ??
        (
          fileSize !== undefined
            ? Number(fileSize)
            : existing.fileSize
        ),
      mimeType: computedMimeType,
      updatedAt: new Date(),
    };

    if (stored) {
      updateData.fileUrl = stored.fileUrl;
      updateData.storageProvider =
        stored.storageProvider;
      updateData.storageKey = stored.storageKey;
    }

    if (title !== undefined) {
      updateData.title = title
        ? title.trim()
        : null;
    }

    if (expiryDate !== undefined) {
      updateData.expiryDate = expiryDate
        ? new Date(expiryDate)
        : null;
    }

    if (hasReplacement && resetVerification) {
      updateData.status = "PENDING";
      updateData.rejectionReason = null;
      updateData.verifiedBy = null;
      updateData.verifiedAt = null;
    }

    let updated;

    try {
      // Avoid overwriting a document replaced by
      // another request in the meantime.
      const result = await prisma.employeeDocument.updateMany({
        where: {
          id: documentId,
          employeeId,
          organizationId,
          storageProvider: existing.storageProvider,
          storageKey: existing.storageKey,
          fileUrl: existing.fileUrl,
        },
        data: updateData,
      });

      if (result.count !== 1) {
        throw httpError(
          "Document changed. Please retry.",
          409
        );
      }

      updated = await prisma.employeeDocument.findFirst({
        where: {
          id: documentId,
          employeeId,
          organizationId,
        },
      });
    } catch (error) {
      if (stored?.storageProvider === "s3") {
        await cleanupS3(
          stored.storageKey,
          organizationId,
          "Database replacement failed"
        );
      }

      throw error;
    }

    // Remove previous S3 object only after DB update.
    if (
      stored &&
      existing.storageProvider === "s3" &&
      existing.storageKey &&
      existing.storageKey !== stored.storageKey
    ) {
      await cleanupS3(
        existing.storageKey,
        organizationId,
        "Old document replacement"
      );
    }

    // Keep legacy Cloudinary files for migration/rollback.
    return documentForResponse(updated);
  }

  // ----------------------------------------------
  // Delete employee document
  // ----------------------------------------------

  async deleteDocument(
    organizationId,
    employeeId,
    documentId
  ) {
    const existing = await prisma.employeeDocument.findFirst({
      where: {
        id: documentId,
        employeeId,
        organizationId,
      },
    });

    if (!existing) {
      throw httpError("Document not found.", 404);
    }

    const result = await prisma.employeeDocument.deleteMany({
      where: {
        id: documentId,
        employeeId,
        organizationId,
        storageProvider: existing.storageProvider,
        storageKey: existing.storageKey,
        fileUrl: existing.fileUrl,
      },
    });

    if (result.count !== 1) {
      throw httpError(
        "Document changed. Please retry.",
        409
      );
    }

    if (
      existing.storageProvider === "s3" &&
      existing.storageKey
    ) {
      await cleanupS3(
        existing.storageKey,
        organizationId,
        "Deleted document cleanup"
      );
    }

    return {
      success: true,
      message: "Document deleted successfully",
    };
  }

  // ----------------------------------------------
  // Verify / reject document
  // ----------------------------------------------

  async verifyDocument(
    organizationId,
    employeeId,
    documentId,
    {
      status,
      rejectionReason,
      reviewerName,
      reviewerId,
    }
  ) {
    if (
      !["VERIFIED", "REJECTED", "PENDING"].includes(status)
    ) {
      throw httpError(
        "Status must be VERIFIED, REJECTED or PENDING.",
        400
      );
    }

    const existing = await prisma.employeeDocument.findFirst({
      where: {
        id: documentId,
        employeeId,
        organizationId,
      },
      include: {
        employee: {
          include: {
            user: true,
          },
        },
      },
    });

    if (!existing) {
      throw httpError("Document not found.", 404);
    }

    const updated = await prisma.employeeDocument.update({
      where: {
        id: documentId,
      },
      data: {
        status,
        rejectionReason:
          status === "REJECTED"
            ? (
                rejectionReason
                  ? rejectionReason.trim()
                  : "Document rejected by HR"
              )
            : null,
        verifiedBy:
          status === "VERIFIED"
            ? reviewerName || "HR Admin"
            : null,
        verifiedAt:
          status === "VERIFIED"
            ? new Date()
            : null,
      },
    });

    if (existing.employee?.user?.id) {
      const notifTitle =
        status === "VERIFIED"
          ? "Document Verified"
          : status === "REJECTED"
            ? "Document Rejected"
            : "Document Under Review";

      const notifMessage =
        status === "VERIFIED"
          ? `Your ${existing.documentType.replace(
              /_/g,
              " "
            )} document has been verified and approved.`
          : status === "REJECTED"
            ? `Your ${existing.documentType.replace(
                /_/g,
                " "
              )} document was rejected. Reason: ${
                rejectionReason ||
                "Please re-upload a clear copy."
              }`
            : `Your ${existing.documentType.replace(
                /_/g,
                " "
              )} status was set to pending.`;

      try {
        await notificationService.createNotification({
          organizationId,
          userId: existing.employee.user.id,
          title: notifTitle,
          message: notifMessage,
          type: "SYSTEM",
        });
      } catch (error) {
        console.warn(
          "Failed to notify employee:",
          error.message
        );
      }
    }

    return documentForResponse(updated);
  }

  // ----------------------------------------------
  // Document expiry reminder
  // ----------------------------------------------

  async sendExpiryReminder(
    organizationId,
    employeeId,
    documentId
  ) {
    const document = await prisma.employeeDocument.findFirst({
      where: {
        id: documentId,
        employeeId,
        organizationId,
      },
      include: {
        employee: {
          include: {
            user: true,
          },
        },
      },
    });

    if (!document) {
      throw httpError("Document not found.", 404);
    }

    if (!document.expiryDate) {
      throw httpError(
        "Document has no expiry date set.",
        400
      );
    }

    const expiry = new Date(document.expiryDate);

    const formattedDate = expiry.toLocaleDateString(
      "en-IN",
      {
        day: "numeric",
        month: "short",
        year: "numeric",
      }
    );

    await prisma.employeeDocument.update({
      where: {
        id: documentId,
      },
      data: {
        expiryReminderSent: true,
      },
    });

    if (document.employee?.user?.id) {
      await notificationService.createNotification({
        organizationId,
        userId: document.employee.user.id,
        title: "Document Expiry Reminder",
        message: `Your ${document.documentType.replace(
          /_/g,
          " "
        )} document expires on ${formattedDate}. Please submit an updated copy.`,
        type: "SYSTEM",
      });
    }

    return {
      success: true,
      message: `Expiry reminder sent for ${document.documentType} (Expires: ${formattedDate})`,
    };
  }
}

module.exports = new EmployeeDocumentService();
