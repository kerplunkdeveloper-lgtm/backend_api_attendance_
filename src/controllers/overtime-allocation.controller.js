const service = require("../services/overtime-allocation.service");
const { fail } = require("../utils/response");

class OvertimeAllocationController {
  async mine(req, res) { try { return res.json({ success: true, data: await service.mine(req.user.id, req.user.organizationId, req.query.month, req.query.year) }); } catch (error) { return fail(res, error); } }
  async submit(req, res) { try { return res.status(201).json({ success: true, data: await service.submit(req.user.id, req.user.organizationId, req.body) }); } catch (error) { return fail(res, error); } }
  async list(req, res) { try { return res.json({ success: true, data: await service.list(req.user.organizationId, req.user.role, req.query) }); } catch (error) { return fail(res, error); } }
  async review(req, res) { try { return res.json({ success: true, data: await service.review(req.params.id, req.user.organizationId, req.user.id, req.user.role, req.body) }); } catch (error) { return fail(res, error); } }
}

module.exports = new OvertimeAllocationController();
