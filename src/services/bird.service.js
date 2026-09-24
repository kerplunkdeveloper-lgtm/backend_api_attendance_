const { BirdClient } = require("@messagebird/sdk");

class BirdEmailService {
  constructor() {
    this.apiKey = process.env.BIRD_API_KEY || "";
    this.fromEmail = process.env.BIRD_FROM_EMAIL || "onboarding@messagebird.dev";
    this.fromName = process.env.BIRD_FROM_NAME || "WorkPulse";
    this.client = null;

    if (this.apiKey && this.apiKey.trim() !== "") {
      try {
        this.client = new BirdClient({ apiKey: this.apiKey.trim() });
        console.log("[BirdEmailService] BirdClient initialized successfully with API key");
      } catch (err) {
        console.error("[BirdEmailService] Failed to initialize BirdClient:", err.message);
      }
    } else {
      console.warn("[BirdEmailService] No BIRD_API_KEY provided.");
    }
  }

  isReady() {
    return !!this.client;
  }

  /**
   * Send email using Bird Email API
   * @param {Object} params
   * @param {string|string[]} params.to - Recipient email address(es)
   * @param {string} params.subject - Email subject
   * @param {string} params.html - HTML body
   * @param {string} [params.text] - Plain text body
   */
  async sendEmail({ to, subject, html, text }) {
    if (!this.client) {
      return {
        success: false,
        error: "BirdClient is not configured or missing API key",
      };
    }

    const recipients = Array.isArray(to) ? to : [to];
    const sanitizedRecipients = recipients.map((r) => (typeof r === "string" ? r.trim() : r?.email)).filter(Boolean);

    if (!sanitizedRecipients.length) {
      return { success: false, error: "No valid recipient email provided" };
    }

    try {
      const payload = {
        from: {
          email: this.fromEmail,
          name: this.fromName,
        },
        to: sanitizedRecipients,
        subject: subject || "WorkPulse Notification",
        html: html || (text ? `<p>${text}</p>` : "<p>WorkPulse Notification</p>"),
      };

      if (text) {
        payload.text = text;
      }

      console.log(`[BirdEmailService] Sending email to ${sanitizedRecipients.join(", ")} with subject "${subject}"...`);
      const msg = await this.client.email.send(payload);
      console.log(`[BirdEmailService] Sent successfully. ID: ${msg?.id}, Status: ${msg?.status}`);

      return {
        success: true,
        provider: "BIRD",
        id: msg?.id,
        status: msg?.status,
      };
    } catch (error) {
      console.error("[BirdEmailService] Error sending email via Bird:", error.message || error);
      return {
        success: false,
        provider: "BIRD",
        error: error.message || String(error),
      };
    }
  }
}

module.exports = new BirdEmailService();
