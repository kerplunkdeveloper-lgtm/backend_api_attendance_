const express = require("express");
const notificationService = require("../services/notification.service");
const { authenticate } = require("../middleware/auth.middleware");

const router = express.Router();

router.use(authenticate);

// Get my notifications
router.get("/", async (req, res) => {
  try {
    const result = await notificationService.getUserNotifications(req.user.id, req.user.organizationId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Mark single notification as read
router.put("/:id/read", async (req, res) => {
  try {
    await notificationService.markAsRead(req.params.id, req.user.id);
    res.json({ success: true, message: "Notification marked as read" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Mark all as read
router.put("/read-all", async (req, res) => {
  try {
    await notificationService.markAllAsRead(req.user.id, req.user.organizationId);
    res.json({ success: true, message: "All notifications marked as read" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Trigger daily morning (08:50 AM) and evening (06:00 PM) shift reminder notifications
router.post("/trigger-reminders", async (req, res) => {
  try {
    const { reminderType = "ALL" } = req.body;
    let morningResult = { sentCount: 0 };
    let eveningResult = { sentCount: 0 };

    if (reminderType === "MORNING" || reminderType === "ALL") {
      morningResult = await notificationService.sendMorningCheckInReminders(req.user.organizationId);
    }
    if (reminderType === "EVENING" || reminderType === "ALL") {
      eveningResult = await notificationService.sendEveningCheckOutReminders(req.user.organizationId);
    }

    res.json({
      success: true,
      message: "Daily attendance reminders evaluated successfully",
      data: {
        morning: morningResult,
        evening: eveningResult,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
