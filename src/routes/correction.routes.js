const express = require("express");
const correctionController = require("../controllers/correction.controller");
const { authenticate, authorizeRoles } = require("../middleware/auth.middleware");

const router = express.Router();

router.use(authenticate);

// Employee endpoints
router.post("/", correctionController.create);
router.get("/my", correctionController.getMyRequests);

// Manager / Admin endpoints
router.get(
  "/",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  correctionController.getAllRequests
);

router.put(
  "/:id/review",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  correctionController.review
);

module.exports = router;
