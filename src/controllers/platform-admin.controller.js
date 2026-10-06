const service = require("../services/platform-admin.service");

const handle = (fn) => async (req, res) => {
  try {
    return res.json({ success: true, data: await fn(req) });
  } catch (err) {
    return res.status(err.statusCode || 400).json({ success: false, message: err.message || "Platform request failed" });
  }
};

module.exports = {
  overview: handle(() => service.overview()),
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
};
