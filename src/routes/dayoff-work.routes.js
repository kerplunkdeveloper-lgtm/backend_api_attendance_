const express = require("express");
const service = require("../services/dayoff-work.service");
const { authenticate, authorizeRoles } = require("../middleware/auth.middleware");
const { paginated, fail } = require("../utils/response");

const router = express.Router();
router.use(authenticate);

// Anyone signed in can ask to work on their own day off.
router.post("/", async (req, res) => {
  try {
    const data = await service.createRequest(req.user.id, req.user.organizationId, req.body);
    return res.status(201).json({ success: true, message: "Sent for approval", data });
  } catch (error) {
    return fail(res, error);
  }
});

router.get("/my", async (req, res) => {
  try {
    const data = await service.getMyRequests(req.user.id, req.user.organizationId);
    return res.json({ success: true, data });
  } catch (error) {
    return fail(res, error);
  }
});

// Admins and HR review. HR sees employees' requests; only admins see and approve HR and admin requests.
const reviewers = authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER");

router.get("/", reviewers, async (req, res) => {
  try {
    const result = await service.getRequests(req.user.organizationId, req.query, req.user.role);
    return paginated(res, result);
  } catch (error) {
    return fail(res, error);
  }
});

router.post("/:id/review", reviewers, async (req, res) => {
  try {
    const data = await service.reviewRequest(req.params.id, req.user.organizationId, req.user.id, req.body, req.user.role);
    return res.json({ success: true, message: `Request ${data.status.toLowerCase()}`, data });
  } catch (error) {
    return fail(res, error);
  }
});

module.exports = router;
