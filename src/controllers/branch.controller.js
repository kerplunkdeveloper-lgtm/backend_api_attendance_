const branchService = require("../services/branch.service");
const { sendControllerError } = require("../utils/controllerError");

const create = async (req, res) => {
  try {
    const branch = await branchService.createBranch(
      req.user.organizationId,
      req.body,
    );

    return res.status(201).json({
      success: true,
      message: "Branch created successfully",
      data: branch,
    });
  } catch (error) {
    return sendControllerError(res, error);
  }
};

const list = async (req, res) => {
  try {
    const branches = await branchService.getBranches(req.user.organizationId);

    return res.json({
      success: true,
      message: "Branches fetched successfully",
      data: branches,
    });
  } catch (error) {
    return sendControllerError(res, error);
  }
};

const getById = async (req, res) => {
  try {
    const { id } = req.params;
    const branch = await branchService.getBranchById(
      req.user.organizationId,
      id,
    );

    return res.json({
      success: true,
      message: "Branch fetched successfully",
      data: branch,
    });
  } catch (error) {
    return sendControllerError(res, error, { fallbackStatus: 404 });
  }
};

const update = async (req, res) => {
  try {
    const { id } = req.params;
    const updated = await branchService.updateBranch(
      req.user.organizationId,
      id,
      req.body,
    );

    return res.json({
      success: true,
      message: "Branch updated successfully",
      data: updated,
    });
  } catch (error) {
    return sendControllerError(res, error);
  }
};

const remove = async (req, res) => {
  try {
    const { id } = req.params;
    await branchService.deleteBranch(req.user.organizationId, id);

    return res.json({
      success: true,
      message: "Branch deleted successfully",
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
