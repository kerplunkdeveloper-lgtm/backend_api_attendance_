const express = require("express");
const compOffController = require("../controllers/compoff.controller");
const {
  authenticate,
  authorizeRoles,
} = require("../middleware/auth.middleware");

const router = express.Router();
router.use(authenticate);

// Employee views own balance
router.get("/balance", compOffController.getMyBalance);
// Previously pointed at getMyBalance, so the ledger was never reachable.
router.get("/history", compOffController.getMyHistory);

// Employee redeems comp-off
router.post("/redeem", compOffController.redeemCompOff);

// Admin/Manager credits comp-off days
router.post(
  "/credit",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  compOffController.creditCompOff,
);

// Admin/Manager views all org comp-off balances
router.get(
  "/",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  compOffController.getOrganizationBalances,
);

router.get(
  "/pending",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  compOffController.listPending,
);

router.post(
  "/:id/review",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  compOffController.reviewRedemption,
);

module.exports = router;
