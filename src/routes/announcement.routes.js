const express = require("express");
const announcementController = require("../controllers/announcement.controller");
const notificationService = require("../services/notification.service");
const { authenticate, authorizeRoles } = require("../middleware/auth.middleware");

const router = express.Router();
const manage = authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER", "HR");

router.use(authenticate);
router.get("/", async (req, res, next) => {
  // The scheduler is intentionally optional in production. Generate this
  // tenant's current-day celebrations on demand so the notice board still
  // shows birthdays/anniversaries when no worker is running.
  try {
    await notificationService.sendDailyCelebrationAnnouncements(new Date(), req.user.organizationId);
  } catch (error) {
    // A celebration failure must not hide normal announcements.
    console.warn("[Announcement] Celebration refresh failed:", error.message);
  }
  return announcementController.list(req, res, next);
});
router.post("/", manage, announcementController.create);
router.put("/:id", manage, announcementController.update);
router.delete("/:id", manage, announcementController.remove);

module.exports = router;
