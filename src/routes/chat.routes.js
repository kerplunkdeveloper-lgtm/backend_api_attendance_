const express = require("express");
const chatController = require("../controllers/chat.controller");
const { authenticate, authorizeRoles } = require("../middleware/auth.middleware");

const router = express.Router();
router.use(authenticate);

router.get("/teammates", chatController.teammates);
router.get("/threads", chatController.threads);
router.post("/threads", chatController.open);
// Creating and managing channels is restricted to workspace admins and HR.
router.post("/groups", authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER", "HR"), chatController.createGroup);
router.patch("/groups/:threadId", authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER", "HR"), chatController.updateGroup);
router.delete("/groups/:threadId", authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER", "HR"), chatController.deleteGroup);
router.get("/threads/:threadId/messages", chatController.messages);
router.post("/threads/:threadId/messages", chatController.send);

module.exports = router;
