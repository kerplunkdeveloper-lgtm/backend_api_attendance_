const chatService = require("../services/chat.service");

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
      return res
        .status(err.statusCode || 400)
        .json({ success: false, message: err.message });
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
      return res
        .status(err.statusCode || 400)
        .json({ success: false, message: err.message });
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
      return res
        .status(err.statusCode || 400)
        .json({ success: false, message: err.message });
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
      return res
        .status(err.statusCode || 400)
        .json({ success: false, message: err.message });
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
      return res
        .status(err.statusCode || 400)
        .json({ success: false, message: err.message });
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
      return res
        .status(err.statusCode || 400)
        .json({ success: false, message: err.message });
    }
  },
};
