const announcementService = require("../services/announcement.service");
const { sendControllerError } = require("../utils/controllerError");

const handle = (fn, status = 200) => async (req, res) => {
  try {
    const data = await fn(req);
    return res.status(status).json({ success: true, data });
  } catch (err) {
    return sendControllerError(res, err);
  }
};

module.exports = {
  list: handle((req) => announcementService.list(req.user.organizationId, req.user)),
  create: handle((req) => announcementService.create(req.user.organizationId, req.user, req.body), 201),
  update: handle((req) => announcementService.update(req.user.organizationId, req.user, req.params.id, req.body)),
  remove: handle((req) => announcementService.remove(req.user.organizationId, req.user, req.params.id)),
};
