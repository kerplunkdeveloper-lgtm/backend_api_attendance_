const express = require("express");
const overtimeController = require("../controllers/overtime.controller");
const { authenticate, authorizeRoles } = require("../middleware/auth.middleware");

const router = express.Router();
router.use(authenticate);

// Employee submits OT request
router.post("/request", overtimeController.requestOvertime);

// Employee views own OT requests
router.get("/my", overtimeController.getMyRequests);

// Manager/Admin views all OT requests
router.get(
  "/",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  overtimeController.getAllRequests
);

// Manager/Admin approves or rejects
router.patch(
  "/:id/review",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  overtimeController.reviewRequest
);

module.exports = router;
