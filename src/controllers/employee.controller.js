const employeeService = require("../services/employee.service");

const create = async (req, res) => {
  try {
    const employee = await employeeService.createEmployee(req.user.organizationId, req.body);

    return res.status(201).json({
      success: true,
      message: "Employee and user account created successfully",
      data: employee,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

const list = async (req, res) => {
  try {
    const employees = await employeeService.getEmployees(req.user.organizationId);

    return res.json({
      success: true,
      message: "Employees fetched successfully",
      data: employees,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

const getById = async (req, res) => {
  try {
    const { id } = req.params;
    const employee = await employeeService.getEmployeeById(req.user.organizationId, id);

    return res.json({
      success: true,
      message: "Employee details fetched successfully",
      data: employee,
    });
  } catch (error) {
    return res.status(404).json({
      success: false,
      message: error.message,
    });
  }
};

const update = async (req, res) => {
  try {
    const { id } = req.params;
    const updated = await employeeService.updateEmployee(req.user.organizationId, id, req.body);

    return res.json({
      success: true,
      message: "Employee updated successfully",
      data: updated,
    });
  } catch (error) {
    return res.status(400).json({
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
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

module.exports = {
  create,
  list,
  getById,
  update,
  remove,
};
