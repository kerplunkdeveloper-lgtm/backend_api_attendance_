const express = require("express");
const billingController = require("../controllers/billing.controller");

const router = express.Router();
router.post("/", billingController.webhook);
module.exports = router;
