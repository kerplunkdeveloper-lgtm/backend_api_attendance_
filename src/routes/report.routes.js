const express = require("express");
const reportService = require("../services/report.service");
const { authenticate, authorizeRoles } = require("../middleware/auth.middleware");

const router = express.Router();

router.use(authenticate);

// 1. Daily Attendance Report
router.get(
  "/daily",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  async (req, res) => {
    try {
      const result = await reportService.getDailyReport(req.user.organizationId, req.query.date);
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  }
);

// 2. Monthly Attendance Report
router.get(
  "/monthly",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  async (req, res) => {
    try {
      const result = await reportService.getMonthlyReport(
        req.user.organizationId,
        req.query.month,
        req.query.year
      );
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  }
);

module.exports = router;
