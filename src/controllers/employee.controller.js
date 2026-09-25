const employeeService = require("../services/employee.service");

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
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message,
    });
  }
};

const list = async (req, res) => {
  try {
    const result = await employeeService.getEmployees(
      req.user.organizationId,
      req.query,
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
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message,
    });
  }
};

const getById = async (req, res) => {
  try {
    const { id } = req.params;
    const employee = await employeeService.getEmployeeById(
      req.user.organizationId,
      id,
    );

    return res.json({
      success: true,
      message: "Employee details fetched successfully",
      data: employee,
    });
  } catch (error) {
    return res.status(error.statusCode || 404).json({
      success: false,
      message: error.message,
    });
  }
};

const update = async (req, res) => {
  try {
    const { id } = req.params;
    const updated = await employeeService.updateEmployee(
      req.user.organizationId,
      id,
      req.body,
      { id: req.user.id, role: req.user.role },
    );

    return res.json({
      success: true,
      message: "Employee updated successfully",
      data: updated,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message,
    });
  }
};

const remove = async (req, res) => {
  try {
    const { id } = req.params;
    await employeeService.deleteEmployee(req.user.organizationId, id);

    return res.json({
      success: true,
      message: "Employee and account removed successfully",
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message,
    });
  }
};

const invite = async (req, res) => {
  try {
    const result = await employeeService.inviteEmployee(
      req.user.organizationId,
      req.user.id,
      req.body,
    );
    return res.status(201).json(result);
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message,
    });
  }
};

const getMe = async (req, res) => {
  try {
    const data = await employeeService.getMyEmployee(
      req.user.organizationId,
      req.user.id,
    );
    return res.json({ success: true, data });
  } catch (error) {
    return res
      .status(error.statusCode || 400)
      .json({ success: false, message: error.message });
  }
};

const updateMe = async (req, res) => {
  try {
    const data = await employeeService.updateMyProfile(
      req.user.organizationId,
      req.user.id,
      req.body,
    );
    return res.json({ success: true, message: "Profile updated", data });
  } catch (error) {
    return res
      .status(error.statusCode || 400)
      .json({ success: false, message: error.message });
  }
};

module.exports = {
  create,
  list,
  getById,
  update,
  remove,
  invite,
  getMe,
  updateMe,
};
