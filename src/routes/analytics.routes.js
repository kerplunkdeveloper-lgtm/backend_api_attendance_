const express = require("express");
const { authenticate, authorizeRoles } = require("../middleware/auth.middleware");
const { attendanceAnalytics } = require("../services/analytics.service");
const { attendancePredictions } = require("../services/predictive-analytics.service");

const router = express.Router();
router.use(authenticate, authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER", "HR"));
router.get("/attendance", async (req, res) => {
  try { return res.json({ success: true, data: await attendanceAnalytics(req.user, req.query) }); }
  catch (error) { return res.status(error.statusCode || 500).json({ success: false, message: error.message }); }
});
router.get("/predictions", async (req, res) => {
  try { return res.json({ success: true, data: await attendancePredictions(req.user, req.query) }); }
  catch (error) { return res.status(error.statusCode || 500).json({ success: false, message: error.message }); }
});

module.exports = router;
