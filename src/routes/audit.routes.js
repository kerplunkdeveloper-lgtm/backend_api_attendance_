const express = require("express");
const auditService = require("../services/audit.service");
const {
  authenticate,
  authorizeRoles,
} = require("../middleware/auth.middleware");

const router = express.Router();

router.use(authenticate);

// Audit details include the (redacted) request bodies, which carry salary and payroll figures,
// so the log is for admins only.
router.get(
  "/",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN"),
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

module.exports = router;
