const express = require("express");
const { authenticate, authorizeRoles } = require("../middleware/auth.middleware");
const { integrationStatus } = require("../services/integration-status.service");

const router = express.Router();
router.get("/status", authenticate, authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "HR"), (req, res) => {
  res.json({ success: true, data: { providers: integrationStatus(), checkedAt: new Date().toISOString() } });
});

module.exports = router;
