const express = require("express");
const controller = require("../controllers/webhook.controller");
const { authenticate, authorizeRoles, requireFeature } = require("../middleware/auth.middleware");

const router = express.Router();
router.use(authenticate, authorizeRoles("COMPANY_ADMIN"), requireFeature("hasApiAccess", "API access"));
router.get("/", controller.list);
router.post("/", controller.create);
router.patch("/:id", controller.update);
router.delete("/:id", controller.remove);
router.post("/:id/test", controller.test);

module.exports = router;
