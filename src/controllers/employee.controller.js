const employeeService = require("../services/employee.service");
const { sendControllerError } = require("../utils/controllerError");
const auditService = require("../services/audit.service");

const create = async (req, res) => {
  try {
    const employee = await employeeService.createEmployee(
      req.user.organizationId,
      req.body,
      req.user.role,
    );

    return res.status(201).json({
      success: true,
      message: "Employee and user account created successfully",
      data: employee,
    });
  } catch (error) { return sendControllerError(res, error); }
};

const list = async (req, res) => {
  try {
    const result = await employeeService.getEmployees(
      req.user.organizationId,
      req.query,
      req.user.role,
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
  } catch (error) { return sendControllerError(res, error); }
};

const exportCsv = async (req, res) => {
  try {
    const file = await employeeService.exportEmployeesCsv(req.user.organizationId, req.query);
    await auditService.logAction({
      organizationId: req.user.organizationId,
      userId: req.user.id,
      action: "EXPORT",
      entity: "Employee",
      details: { rows: file.rowCount, filters: req.query },
      ipAddress: req.ip,
    });
    return res.json({ success: true, data: file });
  } catch (error) { return sendControllerError(res, error); }
};

const getById = async (req, res) => {
  try {
    const { id } = req.params;
    const employee = await employeeService.getEmployeeById(
      req.user.organizationId,
      id,
      req.user.role,
    );

    return res.json({
      success: true,
      message: "Employee details fetched successfully",
      data: employee,
    });
  } catch (error) { return sendControllerError(res, error, { fallbackStatus: 404 }); }
};

const update = async (req, res) => {
  try {
    const { id } = req.params;
    const updated = await employeeService.updateEmployee(
      req.user.organizationId,
      id,
      req.body,
      { actorRole: req.user.role, actorUserId: req.user.id },
    );

    return res.json({
      success: true,
      message: "Employee updated successfully",
      data: updated,
    });
  } catch (error) { return sendControllerError(res, error); }
};

const bulkSetAccess = async (req, res) => {
  try {
    const action = String(req.body?.action || "").toUpperCase();
    const result = await employeeService.setEmployeesAccess(
      req.user.organizationId,
      req.body?.ids,
      action,
      { userId: req.user.id, role: req.user.role },
    );
    const verb = action === "ACTIVATE" ? "Reactivated" : "Deactivated";
    const message =
      result.failedCount > 0
        ? `${verb} ${result.changedCount} employee(s). ${result.failedCount} could not be updated.`
        : `${verb} ${result.changedCount} employee(s).`;
    return res.json({ success: true, message, data: result });
  } catch (error) { return sendControllerError(res, error); }
};

const remove = async (req, res) => {
  try {
    const { id } = req.params;
    await employeeService.deleteEmployee(req.user.organizationId, id, {
      userId: req.user.id,
      role: req.user.role,
    });

    return res.json({
      success: true,
      message: "Employee and account removed successfully",
    });
  } catch (error) { return sendControllerError(res, error); }
};

const bulkDelete = async (req, res) => {
  try {
    const result = await employeeService.bulkDeleteEmployees(
      req.user.organizationId,
      req.body?.ids,
      { userId: req.user.id, role: req.user.role },
    );
    const message =
      result.failedCount > 0
        ? `Deleted ${result.deletedCount} employee(s). ${result.failedCount} could not be deleted.`
        : `Deleted ${result.deletedCount} employee(s) successfully.`;
    return res.json({ success: true, message, data: result });
  } catch (error) { return sendControllerError(res, error); }
};

const invite = async (req, res) => {
  try {
    const result = await employeeService.inviteEmployee(
      req.user.organizationId,
      req.user.id,
      req.body,
      req.user.role,
    );
    return res.status(201).json(result);
  } catch (error) { return sendControllerError(res, error); }
};

const resendInvite = async (req, res) => {
  try {
    const result = await employeeService.resendEmployeeInvite(
      req.user.organizationId,
      req.user.id,
      req.params.id,
    );
    return res.json(result);
  } catch (error) { return sendControllerError(res, error); }
};

const getMe = async (req, res) => {
  try {
    const data = await employeeService.getMyEmployee(
      req.user.organizationId,
      req.user.id,
    );
    return res.json({ success: true, data });
  } catch (error) { return sendControllerError(res, error); }
};

const updateMe = async (req, res) => {
  try {
    const data = await employeeService.updateMyProfile(
      req.user.organizationId,
      req.user.id,
      req.body,
    );
    return res.json({ success: true, message: "Profile updated", data });
  } catch (error) { return sendControllerError(res, error); }
};

const uploadMyAvatar = async (req, res) => {
  try {
    const avatarService = require("../services/avatar.service");
    const url = await avatarService.uploadAvatarFile(req);
    const user = await avatarService.setMyAvatar(
      req.user.id,
      req.user.organizationId,
      url,
    );
    return res.json({
      success: true,
      message: "Profile photo updated",
      data: user,
      user,
    });
  } catch (error) { return sendControllerError(res, error, { fallbackMessage: "Failed to upload photo" }); }
};

const uploadEmployeeAvatar = async (req, res) => {
  try {
    const avatarService = require("../services/avatar.service");
    const url = await avatarService.uploadAvatarFile(req);
    const employee = await avatarService.setEmployeeAvatar(
      req.user.organizationId,
      req.params.id,
      url,
    );
    return res.json({
      success: true,
      message: "Employee photo updated",
      data: employee,
    });
  } catch (error) { return sendControllerError(res, error, { fallbackMessage: "Failed to upload photo" }); }
};


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
      req.user.role,
    );

    return res.status(200).json(result);
  } catch (error) { return sendControllerError(res, error, { fallbackMessage: "Failed to process bulk import" }); }
};

module.exports = {
  exportCsv,
  bulkImport,
  bulkSetAccess,
  create,
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
};
