const nodemailer = require("nodemailer");

/**
 * Gmail SMTP sender. Sends directly through Google's SMTP server using a
 * Gmail App Password, so mail "From" an @gmail.com address passes Gmail's
 * own SPF/DKIM/DMARC checks (unlike relaying a gmail.com sender via Brevo).
 *
 * Env:
 *   GMAIL_USER          e.g. kerplunkdeveloper@gmail.com
 *   GMAIL_APP_PASSWORD  16-char App Password (Google Account → Security → App passwords)
 *   GMAIL_FROM_NAME     optional display name (default "WorkPluse")
 */
class GmailEmailService {
  constructor() {
    this.user = (process.env.GMAIL_USER || "").trim();
    // App passwords are shown with spaces ("abcd efgh ijkl mnop"); strip them.
    this.pass = (process.env.GMAIL_APP_PASSWORD || "").replace(/\s+/g, "");
    this.fromName = process.env.GMAIL_FROM_NAME || process.env.BREVO_FROM_NAME || "WorkPluse";
    this.transporter = null;
  }

  isReady() {
    return !!(this.user && this.pass);
  }

  getTransporter() {
    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        host: "smtp.gmail.com",
        port: 465,
        secure: true,
        auth: { user: this.user, pass: this.pass },
        pool: true,
        maxConnections: 3,
        connectionTimeout: 15000,
        greetingTimeout: 10000,
        socketTimeout: 20000,
      });
    }
    return this.transporter;
  }

  async sendEmail({ to, subject, html, text, attachments = [] }) {
    if (!this.isReady()) {
      return { success: false, provider: "GMAIL", error: "Gmail SMTP is not configured" };
    }

    const recipients = (Array.isArray(to) ? to : [to])
      .map((r) => (typeof r === "string" ? r.trim() : r?.email))
      .filter(Boolean);
    if (!recipients.length) {
      return { success: false, provider: "GMAIL", error: "No valid recipient email provided" };
    }

    try {
      const info = await this.getTransporter().sendMail({
        from: { name: this.fromName, address: this.user },
        to: recipients.join(", "),
        subject: subject || "WorkPluse Notification",
        html: html || (text ? `<p>${text}</p>` : "<p>WorkPluse Notification</p>"),
        ...(text ? { text } : {}),
        // Callers pass Brevo-style attachments: { name, content (base64) }.
        attachments: attachments.map((a) => ({
          filename: a.name || a.filename,
          content: a.content,
          encoding: a.encoding || "base64",
        })),
      });

      if (info.rejected && info.rejected.length) {
        return { success: false, provider: "GMAIL", error: `Rejected: ${info.rejected.join(", ")}` };
      }
      console.log(`[GmailEmailService] Sent successfully. messageId: ${info.messageId}`);
      return { success: true, provider: "GMAIL", id: info.messageId };
    } catch (error) {
      console.error("[GmailEmailService] Error sending email via Gmail:", error.message || error);
      return { success: false, provider: "GMAIL", error: error.message || String(error) };
    }
  }
}

module.exports = new GmailEmailService();
module.exports.GmailEmailService = GmailEmailService;
