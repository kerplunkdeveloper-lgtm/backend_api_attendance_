const service = require("../services/platform-admin.service");
const { sendControllerError } = require("../utils/controllerError");

const handle = (fn) => async (req, res) => {
  try {
    return res.json({ success: true, data: await fn(req) });
  } catch (err) {
    return sendControllerError(res, err, { fallbackMessage: "Platform request failed" });
  }
};

module.exports = {
  overview: handle(() => service.overview()),
  revenueHistory: handle((req) => service.revenueHistory(req.query)),
  listClients: handle((req) => service.listClients(req.query)),
  getClient: handle((req) => service.getClient(req.params.id)),
  attention: handle(() => service.attention()),
  activity: handle((req) => service.activityLog(req.query)),
  applyAction: handle((req) =>
    service.applyAction(
      req.params.id,
      { userId: req.user.id, organizationId: req.user.organizationId, ip: req.ip },
      req.body,
    ),
  ),
  sendAdminPasswordReset: handle((req) =>
    service.sendAdminPasswordReset(req.params.id, { userId: req.user.id, organizationId: req.user.organizationId, ip: req.ip }),
  ),
};
