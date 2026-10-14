const companyLeaveService = require("../services/company-leave.service");
const { sendControllerError } = require("../utils/controllerError");

const sendError = (res, error) => sendControllerError(res, error);

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
