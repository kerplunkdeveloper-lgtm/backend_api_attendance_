const express = require("express");
const notificationService = require("../services/notification.service");
const emailService = require("../services/email.service");
const whatsappService = require("../services/whatsapp.service");
const {
  authenticate,
  authorizeRoles,
} = require("../middleware/auth.middleware");

const router = express.Router();

router.use(authenticate);

// Diagnostics and broadcast triggers expose provider config and can send mail to
// arbitrary addresses, so they are administrator-only.
const adminOnly = authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN");

// Get my notifications
router.get("/", async (req, res) => {
  try {
    const result = await notificationService.getUserNotifications(
      req.user.id,
      req.user.organizationId,
    );
    // `data` mirrors `notifications` so clients using the standard envelope work.
    return res.json({ ...result, data: result.notifications });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Communication channels health and configuration status
router.get("/communication-status", adminOnly, async (req, res) => {
  try {
    const connectionStatus = await emailService.verifyConnection();
    return res.json({
      success: true,
      email: {
        isConfigured:
          connectionStatus.bird.configured || connectionStatus.smtp.configured,
        activeProvider: connectionStatus.activeProvider,
        bird: connectionStatus.bird,
        smtp: connectionStatus.smtp,
        from:
          process.env.BIRD_FROM_EMAIL ||
          process.env.EMAIL_FROM ||
          "onboarding@messagebird.dev",
      },
      whatsapp: {
        isConfigured: whatsappService.isConfigured,
        provider: "Twilio",
        senderNumber:
          process.env.TWILIO_WHATSAPP_NUMBER || "whatsapp:+14155238886",
        mode: whatsappService.isConfigured ? "LIVE" : "SIMULATION",
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Diagnostic endpoint: Dispatch test email
router.post("/test-email", adminOnly, async (req, res) => {
  try {
    const recipient = req.body.to || req.user.email;
    if (!recipient) {
      return res
        .status(400)
        .json({
          success: false,
          message: "Target email address required in 'to' body field",
        });
    }

    const testHtml = emailService.buildHtmlTemplate({
      title: "WorkPulse Test Notification",
      badge: "Diagnostic Test",
      badgeColor: "#10b981",
      contentHtml: `
        <p class="text">Hello <strong>${req.user.name || "Colleague"}</strong>,</p>
        <p class="text">This is a verified test email sent from the <strong>WorkPulse Automation & Communication Gateway</strong>.</p>
        <div class="info-card">
          <div class="info-row"><span class="info-label">Sender:</span><span class="info-value">WorkPulse Automated Dispatch</span></div>
          <div class="info-row"><span class="info-label">Recipient:</span><span class="info-value">${recipient}</span></div>
          <div class="info-row"><span class="info-label">Status:</span><span class="info-value" style="color:#10b981;font-weight:bold;">Operational</span></div>
        </div>
      `,
      ctaText: "Open WorkPulse Portal",
      ctaUrl: process.env.FRONTEND_URL || "http://localhost:3000",
    });

    const result = await emailService.sendEmail({
      to: recipient,
      subject: "[WorkPulse Diagnostic] System Communication Test",
      html: testHtml,
    });

    return res.json({
      success: true,
      message: `Test email dispatched to ${recipient}`,
      deliveryResult: result,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Diagnostic endpoint: Dispatch test WhatsApp alert
router.post("/test-whatsapp", adminOnly, async (req, res) => {
  try {
    const recipient = req.body.to || req.user.phone;
    if (!recipient) {
      return res
        .status(400)
        .json({
          success: false,
          message: "Target phone number required in 'to' body field",
        });
    }

    const result = await whatsappService.sendMessage({
      to: recipient,
      message: `*WorkPulse Notification System Test* 🚀\nHello ${req.user.name || "User"},\nYour WorkPulse WhatsApp alerts are active and running!\nTime: ${new Date().toLocaleTimeString("en-IN")}`,
    });

    return res.json({
      success: true,
      message: `Test WhatsApp message processed for ${recipient}`,
      deliveryResult: result,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Mark single notification as read
router.put("/:id/read", async (req, res) => {
  try {
    await notificationService.markAsRead(req.params.id, req.user.id);
    return res.json({ success: true, message: "Notification marked as read" });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Mark all as read
router.put("/read-all", async (req, res) => {
  try {
    await notificationService.markAllAsRead(
      req.user.id,
      req.user.organizationId,
    );
    return res.json({
      success: true,
      message: "All notifications marked as read",
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Trigger daily morning (08:50 AM) and evening (06:00 PM) shift reminder notifications
router.post("/trigger-reminders", adminOnly, async (req, res) => {
  try {
    // Postman/legacy clients send `type`; the web app sends `reminderType`.
    const reminderType = req.body.reminderType || req.body.type || "ALL";
    let morningResult = { sentCount: 0 };
    let eveningResult = { sentCount: 0 };

    if (reminderType === "MORNING" || reminderType === "ALL") {
      morningResult = await notificationService.sendMorningCheckInReminders(
        req.user.organizationId,
      );
    }
    if (reminderType === "EVENING" || reminderType === "ALL") {
      eveningResult = await notificationService.sendEveningCheckOutReminders(
        req.user.organizationId,
      );
    }

    return res.json({
      success: true,
      message: "Daily attendance reminders evaluated successfully",
      data: {
        morning: morningResult,
        evening: eveningResult,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
