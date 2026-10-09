const companyLeaveService = require("../services/company-leave.service");

const sendError = (res, error) =>
  res.status(error.statusCode || 500).json({ success: false, message: error.message });

const list = async (req, res) => {
  try {
    const data = await companyLeaveService.list(req.user.organizationId, req.query);
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error);
  }
};

const create = async (req, res) => {
  try {
    const data = await companyLeaveService.create(req.user.organizationId, { id: req.user.id }, req.body);
    const message = data.notified
      ? `Company leave saved and ${data.notified} employee(s) notified`
      : "Company leave saved";
    return res.status(201).json({ success: true, message, data });
  } catch (error) {
    return sendError(res, error);
  }
};

const remove = async (req, res) => {
  try {
    const data = await companyLeaveService.remove(req.user.organizationId, req.params.id);
    return res.json({ success: true, message: "Company leave removed", data });
  } catch (error) {
    return sendError(res, error);
  }
};

module.exports = { list, create, remove };
