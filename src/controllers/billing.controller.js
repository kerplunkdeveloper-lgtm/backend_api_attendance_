const billingService = require("../services/billing.service");
const invoiceService = require("../services/invoice.service");
const { sendControllerError } = require("../utils/controllerError");

module.exports = {
  async createOrder(req, res) {
    try {
      const data = await billingService.createCheckout(
        req.user.organizationId,
        req.body,
      );
      return res.json({ success: true, data });
    } catch (err) {
      return sendControllerError(res, err);
    }
  },
  // Read-only price preview, so an offer code can be checked before paying.
  async quote(req, res) {
    try {
      const p = await billingService.calculateCheckout(req.user.organizationId, req.body);
      return res.json({
        success: true,
        data: {
          plan: p.plan,
          billingCycle: p.billingCycle,
          couponCode: p.couponCode,
          baseAmountInr: p.baseAmountInr,
          discountAmountInr: p.discountAmountInr,
          taxAmountInr: p.taxAmountInr,
          amountInr: p.amountInr,
          free: p.amountInr === 0 && p.baseAmountInr > 0,
        },
      });
    } catch (err) {
      return sendControllerError(res, err);
    }
  },
  async verify(req, res) {
    try {
      const data = await (req.body.razorpay_subscription_id ? billingService.verifySubscription : billingService.verifyPayment)(
        req.user.organizationId,
        req.body,
      );
      return res.json({ success: true, data });
    } catch (err) {
      return sendControllerError(res, err);
    }
  },
  async cancel(req, res) {
    try {
      const data = await billingService.cancelSubscription(
        req.user.organizationId,
      );
      return res.json({ success: true, data });
    } catch (err) {
      return sendControllerError(res, err);
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
      return sendControllerError(res, err);
    }
  },
  async list(req, res) {
    try {
      const data = await billingService.listOrders(req.user.organizationId);
      return res.json({ success: true, data });
    } catch (err) {
      return sendControllerError(res, err);
      }
  },
  async invoice(req, res) {
    try {
      const { invoice, pdf } = await invoiceService.createInvoicePdf(req.user.organizationId, req.params.id);
      res.set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${invoice.invoiceNumber}.pdf"`,
        "Content-Length": pdf.length,
      });
      return res.send(pdf);
    } catch (err) {
      return sendControllerError(res, err);
    }
  },
};
