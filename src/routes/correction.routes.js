const express = require("express");
const correctionController = require("../controllers/correction.controller");
const {
  authenticate,
  authorizeRoles,
} = require("../middleware/auth.middleware");
const { validate, schemas } = require("../middleware/validate.middleware");

const router = express.Router();

router.use(authenticate);

// Employee endpoints
router.post("/", correctionController.create);
router.post("/request", correctionController.create);
router.get("/my", correctionController.getMyRequests);

// Manager / Admin endpoints
router.get(
  "/",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  correctionController.getAllRequests,
);
router.get(
  "/pending",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  (req, res) => {
    req.query.status = "PENDING";
    return correctionController.getAllRequests(req, res);
  },
);

router.put(
  "/:id/review",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  validate(schemas.reviewRequest),
  correctionController.review,
);
router.post(
  "/:id/review",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  validate(schemas.reviewRequest),
  correctionController.review,
);

module.exports = router;
