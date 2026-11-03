const { Resend } = require("resend");

/**
 * Resend transactional email provider.
 *
 * Keep this provider small and provider-shaped so the rest of the application
 * can use the same email service for OTPs, password resets, invites, and
 * notifications without knowing which vendor delivered the message.
 */
class ResendEmailService {
  constructor() {
    this.apiKey = String(process.env.RESEND_API_KEY || "").trim();
    this.fromEmail = String(process.env.RESEND_FROM_EMAIL || "").trim();
    this.fromName = String(process.env.RESEND_FROM_NAME || "WorkPluse").trim();
    this.client = this.apiKey ? new Resend(this.apiKey) : null;
  }

  isReady() {
    return Boolean(this.client && this.fromEmail);
  }

  async sendEmail({ to, subject, html, text, attachments = [] }) {
    if (!this.isReady()) {
      return {
        success: false,
        provider: "RESEND",
        error: "Resend API key or from address is not configured",
      };
    }

    const recipients = (Array.isArray(to) ? to : [to])
      .map((recipient) => (typeof recipient === "string" ? recipient.trim() : recipient?.email))
      .filter(Boolean);

    if (!recipients.length) {
      return { success: false, provider: "RESEND", error: "No valid recipient email provided" };
    }

    const payload = {
      from: this.fromName ? `${this.fromName} <${this.fromEmail}>` : this.fromEmail,
      to: recipients,
      subject: subject || "WorkPluse Notification",
      html: html || (text ? `<p>${text}</p>` : "<p>WorkPluse Notification</p>"),
      ...(text ? { text } : {}),
      ...(attachments.length ? { attachments } : {}),
    };

    try {
      const { data, error } = await this.client.emails.send(payload);
      if (error) {
        console.error("[ResendEmailService] Send failed:", error);
        return { success: false, provider: "RESEND", error: error.message || String(error) };
      }

      console.log(`[ResendEmailService] Sent successfully. emailId: ${data?.id || "unknown"}`);
      return { success: true, provider: "RESEND", id: data?.id };
    } catch (error) {
      console.error("[ResendEmailService] Error sending email:", error.message || error);
      return { success: false, provider: "RESEND", error: error.message || String(error) };
    }
  }
}

module.exports = new ResendEmailService();
