const express = require("express");
const overtimeController = require("../controllers/overtime.controller");
const {
  authenticate,
  authorizeRoles,
} = require("../middleware/auth.middleware");
const { validate, schemas } = require("../middleware/validate.middleware");

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
  overtimeController.getAllRequests,
);
router.get(
  "/pending",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  (req, res) => {
    req.query.status = "PENDING";
    return overtimeController.getAllRequests(req, res);
  },
);

// Manager/Admin approves or rejects
router.patch(
  "/:id/review",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  validate(schemas.reviewRequest),
  overtimeController.reviewRequest,
);
router.post(
  "/:id/review",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  validate(schemas.reviewRequest),
  overtimeController.reviewRequest,
);

module.exports = router;
