const express = require("express");
const billingController = require("../controllers/billing.controller");
const {
  authenticate,
  authorizeRoles,
} = require("../middleware/auth.middleware");
const { validate, schemas } = require("../middleware/validate.middleware");
const { createRateLimiter } = require("../middleware/rateLimiter.middleware");

// Stops a signed-in user from guessing offer codes through the price preview.
const quoteLimiter = createRateLimiter({ namespace: "billing-quote", windowMs: 60 * 1000, max: 20, keyBy: "user", message: "Too many offer checks. Please wait a minute." });

const router = express.Router();
router.use(authenticate);
router.use(authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN"));

router.post("/quote", quoteLimiter, validate(schemas.billingCheckout), billingController.quote);
router.post("/checkout", validate(schemas.billingCheckout), billingController.createOrder);
// Compatibility aliases for public billing documentation and older clients.
router.post("/create-order", validate(schemas.billingCheckout), billingController.createOrder);
router.post("/verify", validate(schemas.billingVerify), billingController.verify);
router.post("/verify-payment", validate(schemas.billingVerify), billingController.verify);
router.post("/cancel", billingController.cancel);
router.get("/orders", billingController.list);
router.get("/orders/:id/invoice", billingController.invoice);

module.exports = router;
