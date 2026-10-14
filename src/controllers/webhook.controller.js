const service = require("../services/webhook.service");
const { sendControllerError } = require("../utils/controllerError");

const handle = (fn) => async (req, res) => {
  try {
    return res.json({ success: true, data: await fn(req) });
  } catch (error) {
    return sendControllerError(res, error, { fallbackMessage: "Webhook request failed" });
  }
};

module.exports = {
  list: handle((req) => service.listEndpoints(req.user.organizationId)),
  create: handle((req) => service.createEndpoint(req.user.organizationId, req.body)),
  update: handle((req) => service.updateEndpoint(req.user.organizationId, req.params.id, req.body)),
  remove: handle((req) => service.deleteEndpoint(req.user.organizationId, req.params.id)),
  test: handle((req) => service.sendTest(req.user.organizationId, req.params.id)),
};
