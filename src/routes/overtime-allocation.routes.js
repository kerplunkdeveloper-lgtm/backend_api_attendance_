const express = require("express");
const controller = require("../controllers/overtime-allocation.controller");
const { authenticate, authorizeRoles } = require("../middleware/auth.middleware");

const router = express.Router();
router.use(authenticate);
router.get("/my", controller.mine);
router.post("/", controller.submit);
router.get("/", authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER", "HR"), controller.list);
router.patch("/:id/review", authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER", "HR"), controller.review);

module.exports = router;
