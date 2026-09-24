const billingService = require("../services/billing.service");

module.exports = {
  async createOrder(req, res) {
    try {
      const data = await billingService.createCheckout(
        req.user.organizationId,
        req.body,
      );
      return res.json({ success: true, data });
    } catch (err) {
      return res
        .status(err.statusCode || 400)
        .json({ success: false, message: err.message });
    }
  },
  async verify(req, res) {
    try {
      const data = await billingService.verifyPayment(
        req.user.organizationId,
        req.body,
      );
      return res.json({ success: true, data });
    } catch (err) {
      return res
        .status(err.statusCode || 400)
        .json({ success: false, message: err.message });
    }
  },
  async cancel(req, res) {
    try {
      const data = await billingService.cancelSubscription(
        req.user.organizationId,
      );
      return res.json({ success: true, data });
    } catch (err) {
      return res
        .status(err.statusCode || 400)
        .json({ success: false, message: err.message });
    }
  },
  async webhook(req, res) {
    try {
      const signature = req.headers["x-razorpay-signature"];
      const raw = Buffer.isBuffer(req.body)
        ? req.body
        : Buffer.from(JSON.stringify(req.body));
      const data = await billingService.handleWebhook(raw, signature);
      return res.json({ success: true, data });
    } catch (err) {
      return res
        .status(err.statusCode || 400)
        .json({ success: false, message: err.message });
    }
  },
  async list(req, res) {
    try {
      const data = await billingService.listOrders(req.user.organizationId);
      return res.json({ success: true, data });
    } catch (err) {
      return res
        .status(err.statusCode || 400)
        .json({ success: false, message: err.message });
    }
  },
};
