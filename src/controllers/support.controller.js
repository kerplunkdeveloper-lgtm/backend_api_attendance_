const supportService = require("../services/support.service");
const { sendControllerError } = require("../utils/controllerError");

const handle = (fn, status = 200) => async (req, res) => {
  try {
    const data = await fn(req);
    return res.status(status).json({ success: true, data });
  } catch (error) {
    return sendControllerError(res, error);
  }
};

module.exports = {
  list: handle((req) => supportService.list(req.user.organizationId, req.user, req.query)),
  create: handle((req) => supportService.create(req.user.organizationId, req.user, req.body), 201),
  get: handle(async (req) => {
    const ticket = await supportService.findTicket(req.user.organizationId, req.params.id, req.user);
    return {
      ...ticket,
      messages: (ticket.messages || []).filter((message) => supportService.canManage(req.user.role) || !message.isInternal),
    };
  }),
  reply: handle((req) => supportService.reply(req.user.organizationId, req.user, req.params.id, req.body), 201),
  update: handle((req) => supportService.update(req.user.organizationId, req.user, req.params.id, req.body)),
  close: handle((req) => supportService.close(req.user.organizationId, req.user, req.params.id)),
};
