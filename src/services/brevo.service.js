const BREVO_SEND_URL = "https://api.brevo.com/v3/smtp/email";

/**
 * Brevo transactional email (SMTP API), not the campaigns API — this sends one
 * email per call to a single recipient rather than dispatching to a list.
 */
class BrevoEmailService {
  constructor() {
    this.apiKey = (process.env.BREVO_API_KEY || "").trim();
    this.fromEmail = process.env.BREVO_FROM_EMAIL || "onboarding@workpulse.com";
    this.fromName = process.env.BREVO_FROM_NAME || "WorkPulse";

    if (!this.apiKey) {
      console.warn("[BrevoEmailService] No BREVO_API_KEY provided.");
    }
  }

  isReady() {
    return !!this.apiKey;
  }

  /**
   * @param {Object} params
   * @param {string|string[]} params.to - Recipient email address(es)
   * @param {string} params.subject
   * @param {string} params.html
   * @param {string} [params.text]
   */
  async sendEmail({ to, subject, html, text, attachments = [] }) {
    if (!this.apiKey) {
      return { success: false, provider: "BREVO", error: "Brevo API key is not configured" };
    }

    const recipients = Array.isArray(to) ? to : [to];
    const sanitizedRecipients = recipients
      .map((r) => (typeof r === "string" ? r.trim() : r?.email))
      .filter(Boolean)
      .map((email) => ({ email }));

    if (!sanitizedRecipients.length) {
      return { success: false, provider: "BREVO", error: "No valid recipient email provided" };
    }

    try {
      const res = await fetch(BREVO_SEND_URL, {
        method: "POST",
        headers: {
          "api-key": this.apiKey,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          sender: { email: this.fromEmail, name: this.fromName },
          to: sanitizedRecipients,
          subject: subject || "WorkPulse Notification",
          htmlContent: html || (text ? `<p>${text}</p>` : "<p>WorkPulse Notification</p>"),
          ...(text ? { textContent: text } : {}),
          ...(attachments.length ? { attachment: attachments } : {}),
        }),
      });

      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        console.error(`[BrevoEmailService] Send failed (${res.status}):`, body?.message || body);
        return { success: false, provider: "BREVO", error: body?.message || `HTTP ${res.status}` };
      }

      console.log(`[BrevoEmailService] Sent successfully. messageId: ${body?.messageId}`);
      return { success: true, provider: "BREVO", id: body?.messageId };
    } catch (error) {
      console.error("[BrevoEmailService] Error sending email via Brevo:", error.message || error);
      return { success: false, provider: "BREVO", error: error.message || String(error) };
    }
  }
}

module.exports = new BrevoEmailService();
