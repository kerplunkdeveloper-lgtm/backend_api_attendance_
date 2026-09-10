const departmentService = require("../services/department.service");

const create = async (req, res) => {
  try {
    const { name } = req.body;
    const department = await departmentService.createDepartment(req.user.organizationId, name);

    return res.status(201).json({
      success: true,
      message: "Department created successfully",
      data: department,
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
    const departments = await departmentService.getDepartments(req.user.organizationId);

    return res.json({
      success: true,
      message: "Departments fetched successfully",
      data: departments,
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
    const department = await departmentService.getDepartmentById(req.user.organizationId, id);

    return res.json({
      success: true,
      message: "Department fetched successfully",
      data: department,
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
    const { name } = req.body;
    const updated = await departmentService.updateDepartment(req.user.organizationId, id, name);

    return res.json({
      success: true,
      message: "Department updated successfully",
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
    await departmentService.deleteDepartment(req.user.organizationId, id);

    return res.json({
      success: true,
      message: "Department deleted successfully",
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
