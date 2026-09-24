const express = require("express");
const loanController = require("../controllers/loan.controller");
const {
  authenticate,
  authorizeRoles,
} = require("../middleware/auth.middleware");

const router = express.Router();
router.use(authenticate);
router.get("/", loanController.list);
router.post("/", loanController.apply);
router.put(
  "/:id/review",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  loanController.review,
);
module.exports = router;
