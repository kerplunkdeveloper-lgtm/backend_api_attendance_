const express = require("express");
const billingController = require("../controllers/billing.controller");
const {
  authenticate,
  authorizeRoles,
} = require("../middleware/auth.middleware");

const router = express.Router();
router.use(authenticate);
router.use(authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN"));

router.post("/checkout", billingController.createOrder);
router.post("/verify", billingController.verify);
router.post("/cancel", billingController.cancel);
router.get("/orders", billingController.list);

module.exports = router;
