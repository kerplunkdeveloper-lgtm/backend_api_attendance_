const service = require("../services/shoot-settlement.service");
const { fail } = require("../utils/response");

class ShootSettlementController {
  async create(req, res) { try { return res.status(201).json({ success: true, data: await service.create(req.user.id, req.user.organizationId, req.body) }); } catch (e) { return fail(res, e); } }
  async mine(req, res) { try { return res.json({ success: true, data: await service.mine(req.user.id, req.user.organizationId) }); } catch (e) { return fail(res, e); } }
  async list(req, res) { try { return res.json({ success: true, data: await service.list(req.user.organizationId, req.user.role, req.query) }); } catch (e) { return fail(res, e); } }
  async review(req, res) { try { return res.json({ success: true, data: await service.review(req.params.id, req.user.organizationId, req.user.id, req.user.role, req.body) }); } catch (e) { return fail(res, e); } }
}
module.exports = new ShootSettlementController();
