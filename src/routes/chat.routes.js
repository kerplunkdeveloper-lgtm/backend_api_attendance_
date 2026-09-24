const express = require("express");
const chatController = require("../controllers/chat.controller");
const { authenticate } = require("../middleware/auth.middleware");

const router = express.Router();
router.use(authenticate);

router.get("/teammates", chatController.teammates);
router.get("/threads", chatController.threads);
router.post("/threads", chatController.open);
router.post("/groups", chatController.createGroup);
router.get("/threads/:threadId/messages", chatController.messages);
router.post("/threads/:threadId/messages", chatController.send);

module.exports = router;
