const departmentService = require("../services/department.service");
const { sendControllerError } = require("../utils/controllerError");

const create = async (req, res) => {
  try {
    const { name } = req.body;
    const department = await departmentService.createDepartment(
      req.user.organizationId,
      name,
    );

    return res.status(201).json({
      success: true,
      message: "Department created successfully",
      data: department,
    });
  } catch (error) {
    return sendControllerError(res, error);
  }
};

const list = async (req, res) => {
  try {
    const departments = await departmentService.getDepartments(
      req.user.organizationId,
    );

    return res.json({
      success: true,
      message: "Departments fetched successfully",
      data: departments,
    });
  } catch (error) {
    return sendControllerError(res, error);
  }
};

const getById = async (req, res) => {
  try {
    const { id } = req.params;
    const department = await departmentService.getDepartmentById(
      req.user.organizationId,
      id,
    );

    return res.json({
      success: true,
      message: "Department fetched successfully",
      data: department,
    });
  } catch (error) {
    return sendControllerError(res, error, { fallbackStatus: 404 });
  }
};

const update = async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    const updated = await departmentService.updateDepartment(
      req.user.organizationId,
      id,
      name,
    );

    return res.json({
      success: true,
      message: "Department updated successfully",
      data: updated,
    });
  } catch (error) {
    return sendControllerError(res, error);
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
    return sendControllerError(res, error);
  }
};

module.exports = {
  create,
  list,
  getById,
  update,
  remove,
};
