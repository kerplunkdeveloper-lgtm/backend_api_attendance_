const permissionService = require("../services/permission.service");

const sendError = (res, error) =>
  res.status(error.statusCode || 500).json({ success: false, message: error.message });

const my = async (req, res) => {
  try {
    const data = await permissionService.listMine(req.user.organizationId, req.user.id);
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error);
  }
};

const apply = async (req, res) => {
  try {
    const data = await permissionService.apply(req.user.organizationId, req.user.id, req.body);
    return res.status(201).json({ success: true, message: "Permission request submitted", data });
  } catch (error) {
    return sendError(res, error);
  }
};

const cancel = async (req, res) => {
  try {
    const data = await permissionService.cancel(req.user.organizationId, req.user.id, req.params.id);
    return res.json({ success: true, message: "Permission request withdrawn", data });
  } catch (error) {
    return sendError(res, error);
  }
};

const list = async (req, res) => {
  try {
    const data = await permissionService.listForReview(req.user.organizationId, req.query);
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error);
  }
};

const review = async (req, res) => {
  try {
    const data = await permissionService.review(req.user.organizationId, req.params.id, req.body, {
      id: req.user.id,
      role: req.user.role,
    });
    return res.json({ success: true, message: `Permission ${data.status.toLowerCase()}`, data });
  } catch (error) {
    return sendError(res, error);
  }
};

module.exports = { my, apply, cancel, list, review };
