const service = require("../services/ai.service");
const { sendControllerError } = require("../utils/controllerError");
const wrap = (fn) => async (req, res) => { try { return res.json({ success: true, data: await fn(req) }); } catch (e) { return sendControllerError(res, e); } };
module.exports = {
  status: wrap((req) => service.status(req.user)),
  chat: wrap((req) => service.chat({ user: req.user, conversationId: req.body.conversationId, message: req.body.message, selectedEmployeeId: req.body.selectedEmployeeId })),
  people: wrap((req) => service.listAuthorizedEmployees(req.user)),
  conversations: wrap((req) => service.conversations(req.user)),
  messages: wrap((req) => service.messages(req.user, req.params.id)),
  removeConversation: wrap((req) => service.deleteConversation(req.user, req.params.id)),
  knowledge: wrap((req) => service.knowledgeList(req.user)),
  createKnowledge: wrap((req) => service.upsertKnowledge(req.user, req.body)),
  removeKnowledge: wrap((req) => service.deleteKnowledge(req.user, req.params.id)),
};
