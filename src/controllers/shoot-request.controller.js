const service = require("../services/shoot-request.service");
const { paginated, fail } = require("../utils/response");
class ShootRequestController {
  async create(req, res) { try { const data = await service.create(req.user.id, req.user.organizationId, req.body); return res.status(201).json({ success: true, message: "Shoot request submitted for approval", data }); } catch (e) { return fail(res, e); } }
  async participants(req, res) { try { return res.json({ success: true, data: await service.participants(req.user.organizationId) }); } catch (e) { return fail(res, e); } }
  async mine(req, res) { try { return res.json({ success: true, data: await service.mine(req.user.id, req.user.organizationId) }); } catch (e) { return fail(res, e); } }
  async list(req, res) { try { return paginated(res, await service.list(req.user.organizationId, req.query, req.user.role)); } catch (e) { return fail(res, e); } }
  async cancel(req, res) { try { const data = await service.cancel(req.params.id, req.user.organizationId, req.user.id, req.user.role); return res.json({ success: true, message: "Shoot request cancelled", data }); } catch (e) { return fail(res, e); } }
  async reviewCancellation(req, res) { try { const data = await service.reviewCancellation(req.params.id, req.user.organizationId, req.user.id, req.body, req.user.role); return res.json({ success: true, message: `Shoot cancellation ${req.body.status.toLowerCase()}`, data }); } catch (e) { return fail(res, e); } }
  async review(req, res) { try { const data = await service.review(req.params.id, req.user.organizationId, req.user.id, req.body, req.user.role); return res.json({ success: true, message: `Shoot request ${data.status.toLowerCase()}`, data }); } catch (e) { return fail(res, e); } }
}
module.exports = new ShootRequestController();