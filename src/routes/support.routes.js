const express = require("express");
const supportController = require("../controllers/support.controller");
const { authenticate, authorizeRoles } = require("../middleware/auth.middleware");

const router = express.Router();
const manage = authorizeRoles("SUPER_ADMIN", "DEVELOPER", "COMPANY_ADMIN", "MANAGER", "HR");

router.use(authenticate);
router.get("/", supportController.list);
router.post("/", supportController.create);
router.get("/:id", supportController.get);
router.post("/:id/messages", supportController.reply);
router.patch("/:id", manage, supportController.update);
router.post("/:id/close", supportController.close);

module.exports = router;
