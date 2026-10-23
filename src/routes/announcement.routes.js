const express = require("express");
const announcementController = require("../controllers/announcement.controller");
const { authenticate, authorizeRoles } = require("../middleware/auth.middleware");

const router = express.Router();
const manage = authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER");

router.use(authenticate);
router.get("/", announcementController.list);
router.post("/", manage, announcementController.create);
router.put("/:id", manage, announcementController.update);
router.delete("/:id", manage, announcementController.remove);

module.exports = router;
