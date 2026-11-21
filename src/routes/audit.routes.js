const express = require("express");
const auditService = require("../services/audit.service");
const {
  authenticate,
  authorizeRoles,
} = require("../middleware/auth.middleware");

const router = express.Router();

router.use(authenticate);

// Audit details are redacted by the middleware. HR and managers need access to
// security/attendance events so they can review duplicate-device alerts.
router.get(
  "/",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER", "HR"),
  async (req, res) => {
    try {
      const result = await auditService.getAuditLogs(
        req.user.organizationId,
        req.query,
      );
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  },
);

router.patch(
  "/:id/review",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER", "HR"),
  async (req, res) => {
    try {
      const log = await auditService.reviewLog(
        req.user.organizationId,
        req.params.id,
        req.user.id,
        req.body.status,
        req.body.note,
      );
      return res.json({ success: true, log });
    } catch (err) {
      return res.status(err.statusCode || 400).json({ success: false, message: err.message });
    }
  },
);

module.exports = router;
