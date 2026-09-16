const express = require("express");
const compOffController = require("../controllers/compoff.controller");
const { authenticate, authorizeRoles } = require("../middleware/auth.middleware");

const router = express.Router();
router.use(authenticate);

// Employee views own balance
router.get("/balance", compOffController.getMyBalance);

// Employee redeems comp-off
router.post("/redeem", compOffController.redeemCompOff);

// Admin/Manager credits comp-off days
router.post(
  "/credit",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  compOffController.creditCompOff
);

// Admin/Manager views all org comp-off balances
router.get(
  "/",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  compOffController.getOrganizationBalances
);

module.exports = router;
