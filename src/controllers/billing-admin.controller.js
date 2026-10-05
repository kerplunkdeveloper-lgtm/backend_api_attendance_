const service = require("../services/billing-admin.service");

const sendError = (res, err) => res.status(err.statusCode || 400).json({ success: false, message: err.message || "Billing administration failed" });

module.exports = {
  async listPrices(req, res) {
    try { return res.json({ success: true, data: await service.listPlanPrices() }); } catch (err) { return sendError(res, err); }
  },
  async updatePrice(req, res) {
    try { return res.json({ success: true, data: await service.upsertPlanPrice({ ...req.body, plan: req.params.plan, billingCycle: req.params.billingCycle, userId: req.user.id }) }); } catch (err) { return sendError(res, err); }
  },
  async listOffers(req, res) {
    try { return res.json({ success: true, data: await service.listOffers() }); } catch (err) { return sendError(res, err); }
  },
  async createOffer(req, res) {
    try { return res.status(201).json({ success: true, data: await service.createOffer(req.body, req.user.id) }); } catch (err) { return sendError(res, err); }
  },
  async updateOffer(req, res) {
    try { return res.json({ success: true, data: await service.updateOffer(req.params.id, req.body, req.user.id) }); } catch (err) { return sendError(res, err); }
  },
  async deactivateOffer(req, res) {
    try { return res.json({ success: true, data: await service.deactivateOffer(req.params.id, req.user.id) }); } catch (err) { return sendError(res, err); }
  },
};
