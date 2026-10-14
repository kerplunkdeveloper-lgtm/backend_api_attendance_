const chatService = require("../services/chat.service");
const { sendControllerError } = require("../utils/controllerError");

module.exports = {
  async teammates(req, res) {
    try {
      const data = await chatService.listTeammates(
        req.user.organizationId,
        req.user.id,
        req.query,
      );
      return res.json({ success: true, data });
    } catch (err) {
      return sendControllerError(res, err);
    }
  },
  async threads(req, res) {
    try {
      const data = await chatService.listThreads(
        req.user.organizationId,
        req.user.id,
        req.query,
      );
      return res.json({ success: true, data });
    } catch (err) {
      return sendControllerError(res, err);
    }
  },
  async open(req, res) {
    try {
      const data = await chatService.openDirect(
        req.user.organizationId,
        req.user.id,
        req.body.userId,
      );
      return res.json({ success: true, data });
    } catch (err) {
      return sendControllerError(res, err);
    }
  },
  async createGroup(req, res) {
    try {
      const data = await chatService.createGroup(
        req.user.organizationId,
        req.user.id,
        req.body,
      );
      return res.status(201).json({ success: true, data });
    } catch (err) {
      return sendControllerError(res, err);
    }
  },
  async messages(req, res) {
    try {
      const data = await chatService.getMessages(
        req.user.organizationId,
        req.user.id,
        req.params.threadId,
        req.query,
      );
      return res.json({ success: true, data });
    } catch (err) {
      return sendControllerError(res, err);
    }
  },
  async send(req, res) {
    try {
      const data = await chatService.sendMessage(
        req.user.organizationId,
        req.user.id,
        req.params.threadId,
        req.body.body || req.body.message || req.body.text,
      );
      return res.status(201).json({ success: true, data });
    } catch (err) {
      return sendControllerError(res, err);
    }
  },
};
