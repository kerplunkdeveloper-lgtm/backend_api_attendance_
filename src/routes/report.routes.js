const express = require("express");
const reportService = require("../services/report.service");
const { authenticate, authorizeRoles } = require("../middleware/auth.middleware");
const asyncJobs = require("../services/async-job.service");

const router = express.Router();

router.use(authenticate);

router.post("/daily/async", authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"), async (req, res) => {
  const job = await asyncJobs.createJob({ organizationId: req.user.organizationId, userId: req.user.id, type: "REPORT_DAILY", payload: { date: req.body?.date || null } });
  return res.status(202).json({ success: true, message: "Daily report queued", data: job });
});

router.post("/monthly/async", authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"), async (req, res) => {
  const month = Number(req.body?.month);
  const year = Number(req.body?.year);
  if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year < 2000 || year > 2200) return res.status(400).json({ success: false, message: "A valid month and year are required" });
  const job = await asyncJobs.createJob({ organizationId: req.user.organizationId, userId: req.user.id, type: "REPORT_MONTHLY", payload: { month, year } });
  return res.status(202).json({ success: true, message: "Monthly report queued", data: job });
});

// 1. Daily Attendance Report
router.get(
  "/daily",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  async (req, res) => {
    try {
      const result = await reportService.getDailyReport(req.user.organizationId, req.query.date);
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
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
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }
);

module.exports = router;
