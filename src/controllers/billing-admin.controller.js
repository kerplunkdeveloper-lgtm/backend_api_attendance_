const service = require("../services/billing-admin.service");
const { sendControllerError } = require("../utils/controllerError");

const sendError = (res, err) => sendControllerError(res, err, { fallbackMessage: "Billing administration failed" });

module.exports = {
  async listPrices(req, res) {
    try { return res.json({ success: true, data: await service.listPlanPrices() }); } catch (err) { return sendError(res, err); }
  },
  async updatePrice(req, res) {
    try { return res.json({ success: true, data: await service.upsertPlanPrice({ ...req.body, plan: req.params.plan, billingCycle: req.params.billingCycle, userId: req.user.id }) }); } catch (err) { return sendError(res, err); }
  },
  async listLimits(req, res) {
    try { return res.json({ success: true, data: await service.listPlanLimits() }); } catch (err) { return sendError(res, err); }
  },
  async updateLimit(req, res) {
    try { return res.json({ success: true, data: await service.upsertPlanLimit({ ...req.body, plan: req.params.plan, userId: req.user.id }) }); } catch (err) { return sendError(res, err); }
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
