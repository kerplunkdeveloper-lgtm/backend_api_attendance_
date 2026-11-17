
const employeeService = require("../services/employee.service");
const { getNextEmployeeCode } = require("../utils/employeeCode");
const prisma = require("../config/database");
const { sendControllerError } = require("../utils/controllerError");
const auditService = require("../services/audit.service");

// --------------------------------------------------
// Create employee
// --------------------------------------------------

const create = async (req, res) => {
  try {
    const employee = await employeeService.createEmployee(
      req.user.organizationId,
      req.body,
      req.user.role
    );

    return res.status(201).json({
      success: true,
      message: "Employee and user account created successfully",
      data: employee,
    });
  } catch (error) {
    return sendControllerError(res, error);
  }
};

// --------------------------------------------------
// List employees
// --------------------------------------------------

const list = async (req, res) => {
  try {
    const result = await employeeService.getEmployees(
      req.user.organizationId,
      req.query,
      req.user.role
    );

    return res.json({
      success: true,
      message: "Employees fetched successfully",
      data: result.records,
      records: result.records,
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
    });
  } catch (error) {
    return sendControllerError(res, error);
  }
};

// --------------------------------------------------
// Generate next employee code
// --------------------------------------------------

const nextCode = async (req, res) => {
  try {
    const organization = await prisma.organization.findUnique({
      where: {
        id: req.user.organizationId,
      },
      select: {
        name: true,
      },
    });

    if (!organization) {
      return res.status(404).json({
        success: false,
        message: "Organization not found",
      });
    }

    const role = String(
      req.query.role || "EMPLOYEE"
    ).toUpperCase();

    const code = await getNextEmployeeCode(
      req.user.organizationId,
      prisma,
      role,
      organization.name,
      req.query.dateOfJoining || null
    );

    return res.json({
      success: true,
      data: {
        employeeCode: code,
      },
    });
  } catch (error) {
    return sendControllerError(res, error);
  }
};

// --------------------------------------------------
// Export employees CSV
// --------------------------------------------------

const exportCsv = async (req, res) => {
  try {
    const file = await employeeService.exportEmployeesCsv(
      req.user.organizationId,
      req.query
    );

    await auditService.logAction({
      organizationId: req.user.organizationId,
      userId: req.user.id,
      action: "EXPORT",
      entity: "Employee",
      details: {
        rows: file.rowCount,
        filters: req.query,
      },
      ipAddress: req.ip,
    });

    return res.json({
      success: true,
      data: file,
    });
  } catch (error) {
    return sendControllerError(res, error);
  }
};

// --------------------------------------------------
// Get employee by ID
// --------------------------------------------------

const getById = async (req, res) => {
  try {
    const { id } = req.params;

    const employee = await employeeService.getEmployeeById(
      req.user.organizationId,
      id,
      req.user.role
    );

    return res.json({
      success: true,
      message: "Employee details fetched successfully",
      data: employee,
    });
  } catch (error) {
    return sendControllerError(res, error, {
      fallbackStatus: 404,
    });
  }
};

// --------------------------------------------------
// Update employee
// --------------------------------------------------

const update = async (req, res) => {
  try {
    const { id } = req.params;

    const updated = await employeeService.updateEmployee(
      req.user.organizationId,
      id,
      req.body,
      {
        actorRole: req.user.role,
        actorUserId: req.user.id,
      }
    );

    return res.json({
      success: true,
      message: "Employee updated successfully",
      data: updated,
    });
  } catch (error) {
    return sendControllerError(res, error);
  }
};

// --------------------------------------------------
// Bulk activate / deactivate employees
// --------------------------------------------------

const bulkSetAccess = async (req, res) => {
  try {
    const action = String(
      req.body?.action || ""
    ).toUpperCase();

    const result = await employeeService.setEmployeesAccess(
      req.user.organizationId,
      req.body?.ids,
      action,
      {
        userId: req.user.id,
        role: req.user.role,
      }
    );

    const verb =
      action === "ACTIVATE"
        ? "Reactivated"
        : "Deactivated";

    const message =
      result.failedCount > 0
        ? `${verb} ${result.changedCount} employee(s). ${result.failedCount} could not be updated.`
        : `${verb} ${result.changedCount} employee(s).`;

    return res.json({
      success: true,
      message,
      data: result,
    });
  } catch (error) {
    return sendControllerError(res, error);
  }
};

// --------------------------------------------------
// Delete employee
// --------------------------------------------------

const remove = async (req, res) => {
  try {
    const { id } = req.params;

    await employeeService.deleteEmployee(
      req.user.organizationId,
      id,
      {
        userId: req.user.id,
        role: req.user.role,
      }
    );

    return res.json({
      success: true,
      message: "Employee and account removed successfully",
    });
  } catch (error) {
    return sendControllerError(res, error);
  }
};

// --------------------------------------------------
// Bulk delete employees
// --------------------------------------------------

const bulkDelete = async (req, res) => {
  try {
    const result = await employeeService.bulkDeleteEmployees(
      req.user.organizationId,
      req.body?.ids,
      {
        userId: req.user.id,
        role: req.user.role,
      }
    );

    const message =
      result.failedCount > 0
        ? `Deleted ${result.deletedCount} employee(s). ${result.failedCount} could not be deleted.`
        : `Deleted ${result.deletedCount} employee(s) successfully.`;

    return res.json({
      success: true,
      message,
      data: result,
    });
  } catch (error) {
    return sendControllerError(res, error);
  }
};

// --------------------------------------------------
// Invite employee
// --------------------------------------------------

const invite = async (req, res) => {
  try {
    const result = await employeeService.inviteEmployee(
      req.user.organizationId,
      req.user.id,
      req.body,
      req.user.role
    );

    return res.status(201).json(result);
  } catch (error) {
    return sendControllerError(res, error);
  }
};

// --------------------------------------------------
// Resend employee invitation
// --------------------------------------------------

const resendInvite = async (req, res) => {
  try {
    const result = await employeeService.resendEmployeeInvite(
      req.user.organizationId,
      req.user.id,
      req.params.id
    );

    return res.json(result);
  } catch (error) {
    return sendControllerError(res, error);
  }
};

// --------------------------------------------------
// Get my employee profile
// --------------------------------------------------

const getMe = async (req, res) => {
  try {
    const data = await employeeService.getMyEmployee(
      req.user.organizationId,
      req.user.id
    );

    return res.json({
      success: true,
      data,
    });
  } catch (error) {
    return sendControllerError(res, error);
  }
};

// --------------------------------------------------
// Update my employee profile
// --------------------------------------------------

const updateMe = async (req, res) => {
  try {
    const data = await employeeService.updateMyProfile(
      req.user.organizationId,
      req.user.id,
      req.body,
      req.user.role
    );

    return res.json({
      success: true,
      message: "Profile updated",
      data,
    });
  } catch (error) {
    return sendControllerError(res, error);
  }
};

// --------------------------------------------------
// Upload my avatar
// Supports Cloudinary and S3 upload results.
// --------------------------------------------------

const uploadMyAvatar = async (req, res) => {
  try {
    const avatarService = require("../services/avatar.service");

    const uploaded = await avatarService.uploadAvatarFile(req);

    const user = await avatarService.setMyAvatar(
      req.user.id,
      req.user.organizationId,
      uploaded
    );

    return res.json({
      success: true,
      message: "Profile photo updated",
      data: user,
      user,
    });
  } catch (error) {
    return sendControllerError(res, error, {
      fallbackMessage: "Failed to upload photo",
    });
  }
};

// --------------------------------------------------
// Admin / Manager uploads employee avatar
// Supports Cloudinary and S3 upload results.
// --------------------------------------------------

const uploadEmployeeAvatar = async (req, res) => {
  try {
    const avatarService = require("../services/avatar.service");

    const uploaded = await avatarService.uploadAvatarFile(req);

    const employee = await avatarService.setEmployeeAvatar(
      req.user.organizationId,
      req.params.id,
      uploaded
    );

    return res.json({
      success: true,
      message: "Employee photo updated",
      data: employee,
    });
  } catch (error) {
    return sendControllerError(res, error, {
      fallbackMessage: "Failed to upload photo",
    });
  }
};

// --------------------------------------------------
// Bulk import employees
// --------------------------------------------------

const bulkImport = async (req, res) => {
  try {
    const employees = Array.isArray(req.body.employees)
      ? req.body.employees
      : Array.isArray(req.body)
        ? req.body
        : [];

    if (!employees || employees.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No employee records found in request body",
      });
    }

    const result = await employeeService.bulkImportEmployees(
      req.user.organizationId,
      employees,
      req.user.role
    );

    return res.status(200).json(result);
  } catch (error) {
    return sendControllerError(res, error, {
      fallbackMessage: "Failed to process bulk import",
    });
  }
};

// --------------------------------------------------
// Employee celebrations
// --------------------------------------------------

const celebrations = async (req, res) => {
  try {
    const data = await employeeService.getCelebrations(
      req.user.organizationId,
      req.user.role
    );

    return res.json({
      success: true,
      message: "Celebrations fetched successfully",
      data,
    });
  } catch (error) {
    return sendControllerError(res, error, {
      fallbackMessage: "Failed to load celebrations",
    });
  }
};

// --------------------------------------------------
// Exports
// --------------------------------------------------

const getEmployeeAvatarFile = async (req, res) => {
  try {
    const { getFileContent } = require("../config/s3");

    const organizationId = req.user?.organizationId;
    const employeeId = req.params.id;

    if (!organizationId || !req.user?.id) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const employee = await prisma.employee.findFirst({
      where: {
        id: employeeId,
        organizationId,
        deletedAt: null,
      },
      select: {
        id: true,
        userId: true,
        avatarStorageKey: true,
      },
    });

    if (!employee || !employee.avatarStorageKey) {
      return res.status(404).json({
        success: false,
        message: "Avatar not found",
      });
    }

    const staffRoles = [
      "SUPER_ADMIN",
      "COMPANY_ADMIN",
      "HR",
      "MANAGER",
    ];

    const canRead =
      employee.userId === req.user.id ||
      staffRoles.includes(req.user.role);

    if (!canRead) {
      return res.status(403).json({
        success: false,
        message: "Avatar access denied",
      });
    }

    const key = employee.avatarStorageKey;

    const expectedPrefix =
      `organizations/${encodeURIComponent(String(organizationId))}/avatars/`;

    if (!key.startsWith(expectedPrefix)) {
      return res.status(403).json({
        success: false,
        message: "Invalid avatar reference",
      });
    }

    const file = await getFileContent(
      key,
      organizationId
    );

    const allowedTypes = new Set([
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
    ]);

    if (!allowedTypes.has(file.contentType)) {
      return res.status(415).json({
        success: false,
        message: "Unsupported avatar content",
      });
    }

    res.setHeader("Content-Type", file.contentType);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");

    return res.status(200).send(file.buffer);
  } catch (error) {
    return sendControllerError(res, error, {
      fallbackMessage: "Failed to load avatar",
    });
  }
};

module.exports = {
  celebrations,
  exportCsv,
  bulkImport,
  bulkSetAccess,
  create,
  nextCode,
  list,
  getById,
  update,
  remove,
  bulkDelete,
  invite,
  resendInvite,
  getMe,
  updateMe,
  uploadMyAvatar,
  uploadEmployeeAvatar,
  getEmployeeAvatarFile,
};
