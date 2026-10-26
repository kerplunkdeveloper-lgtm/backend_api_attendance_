const express = require("express");
const chatController = require("../controllers/chat.controller");
const { authenticate, authorizeRoles } = require("../middleware/auth.middleware");

const router = express.Router();
router.use(authenticate);

router.get("/teammates", chatController.teammates);
router.get("/threads", chatController.threads);
router.post("/threads", chatController.open);
// Creating a channel is for admins and HR only (HR is the MANAGER role).
router.post("/groups", authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"), chatController.createGroup);
router.get("/threads/:threadId/messages", chatController.messages);
router.post("/threads/:threadId/messages", chatController.send);

module.exports = router;
