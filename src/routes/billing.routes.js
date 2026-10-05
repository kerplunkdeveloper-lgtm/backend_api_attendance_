const express = require("express");
const billingController = require("../controllers/billing.controller");
const {
  authenticate,
  authorizeRoles,
} = require("../middleware/auth.middleware");
const { validate, schemas } = require("../middleware/validate.middleware");

const router = express.Router();
router.use(authenticate);
router.use(authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN"));

router.post("/checkout", validate(schemas.billingCheckout), billingController.createOrder);
// Compatibility aliases for public billing documentation and older clients.
router.post("/create-order", validate(schemas.billingCheckout), billingController.createOrder);
router.post("/verify", validate(schemas.billingVerify), billingController.verify);
router.post("/verify-payment", validate(schemas.billingVerify), billingController.verify);
router.post("/cancel", billingController.cancel);
router.get("/orders", billingController.list);

module.exports = router;
