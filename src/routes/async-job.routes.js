const express = require("express");
const controller = require("../controllers/async-job.controller");
const { authenticate, authorizeRoles } = require("../middleware/auth.middleware");

const router = express.Router();
router.use(authenticate);
router.get("/", controller.list);
router.get("/:id", controller.get);
router.post("/", authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "HR"), controller.create);

module.exports = router;
