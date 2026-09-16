const twilio = require("twilio");

class WhatsAppService {
  constructor() {
    this.isConfigured = false;
    this.client = null;
    this.initClient();
  }

  initClient() {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;

    if (accountSid && authToken && accountSid.startsWith("AC")) {
      try {
        this.client = twilio(accountSid, authToken);
        this.isConfigured = true;
        console.log("[WhatsAppService] Initialized live Twilio client");
      } catch (err) {
        console.warn(`[WhatsAppService] Failed to initialize live Twilio client: ${err.message}. Falling back to simulation mode.`);
        this.isConfigured = false;
      }
    } else {
      this.isConfigured = false;
    }
  }

  /**
   * Normalizes a phone number to standard Twilio WhatsApp format: whatsapp:+[country][number]
   */
  formatWhatsAppNumber(phone) {
    if (!phone) return null;
    let cleaned = String(phone).replace(/[^\d+]/g, "").trim();

    // Default to +91 if standard 10-digit mobile passed
    if (cleaned.length === 10 && !cleaned.startsWith("+")) {
      cleaned = `+91${cleaned}`;
    } else if (!cleaned.startsWith("+")) {
      cleaned = `+${cleaned}`;
    }

    return `whatsapp:${cleaned}`;
  }

  /**
   * Dispatches WhatsApp message with live/simulation fallback
   */
  async sendMessage({ to, message }) {
    const formattedRecipient = this.formatWhatsAppNumber(to);
    if (!formattedRecipient) {
      console.warn("[WhatsAppService] Invalid or missing phone number. Skipping.");
      return { success: false, message: "Valid phone number required" };
    }

    const from = process.env.TWILIO_WHATSAPP_NUMBER || "whatsapp:+14155238886";

    if (this.isConfigured && this.client) {
      try {
        const response = await this.client.messages.create({
          from,
          to: formattedRecipient,
          body: message,
        });
        console.log(`[WhatsAppService:LIVE] Sent WhatsApp to ${formattedRecipient} (SID: ${response.sid})`);
        return { success: true, live: true, sid: response.sid };
      } catch (err) {
        console.error(`[WhatsAppService:LIVE_FAIL] Failed to send WhatsApp to ${formattedRecipient}:`, err.message);
        return { success: false, error: err.message };
      }
    }

    // Simulation / Dev Fallback
    console.log("────────────────────────────────────────────────────────────");
    console.log(`[WhatsAppService:SIMULATION] Recipient: ${formattedRecipient}`);
    console.log(`[WhatsAppService:SIMULATION] Message:\n${message}`);
    console.log(`[WhatsAppService:SIMULATION] Status:    Simulated (Configure TWILIO_ACCOUNT_SID & TWILIO_AUTH_TOKEN in .env for live WhatsApp)`);
    console.log("────────────────────────────────────────────────────────────");

    return {
      success: true,
      simulated: true,
      message: "WhatsApp logged in simulation mode (Twilio credentials not configured)",
      to: formattedRecipient,
    };
  }

  /**
   * 1. Leave Approval / Rejection WhatsApp Alert
   */
  async sendLeaveStatusWhatsApp(toPhone, employeeName, { status, leaveType, startDate, endDate, totalDays, reviewNote }) {
    const isApproved = status === "APPROVED";
    const emoji = isApproved ? "✅" : "❌";
    const startStr = new Date(startDate).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
    const endStr = new Date(endDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";

    const text = [
      `*WorkPulse Leave Update* ${emoji}`,
      `Hello ${employeeName},`,
      ``,
      `Your leave request for *${totalDays} day(s)* (${leaveType || "Leave"}) has been *${status}*.`,
      `📅 *Dates:* ${startStr} — ${endStr}`,
      reviewNote ? `📝 *Remarks:* ${reviewNote}` : null,
      ``,
      `Check your portal for details: ${frontendUrl}/leaves`,
    ].filter(Boolean).join("\n");

    return await this.sendMessage({ to: toPhone, message: text });
  }

  /**
   * 2. Monthly Payslip Disbursed WhatsApp Alert
   */
  async sendPayslipDisbursedWhatsApp(toPhone, employeeName, { month, year, netSalary }) {
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const monthName = monthNames[(parseInt(month) || 1) - 1];
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";

    const text = [
      `*WorkPulse Salary Alert* 💰`,
      `Hello ${employeeName},`,
      ``,
      `Your salary for *${monthName} ${year}* has been disbursed!`,
      `💵 *Net Disbursed:* ₹${Number(netSalary || 0).toLocaleString("en-IN")}`,
      ``,
      `Download your official payslip PDF here: ${frontendUrl}/payroll`,
    ].join("\n");

    return await this.sendMessage({ to: toPhone, message: text });
  }

  /**
   * 3. Morning Shift Reminder WhatsApp Alert
   */
  async sendShiftReminderWhatsApp(toPhone, employeeName, { shiftName, shiftTime, punchUrl }) {
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
    const link = punchUrl || frontendUrl;

    const text = [
      `*WorkPulse Attendance Reminder* ⏰`,
      `Good morning ${employeeName} 👋,`,
      ``,
      `Your shift *${shiftName || "General Shift"}* starts at *${shiftTime || "09:00 AM"}*.`,
      `Please remember to clock in when you arrive!`,
      ``,
      `📍 Clock in here: ${link}`,
    ].join("\n");

    return await this.sendMessage({ to: toPhone, message: text });
  }

  /**
   * 4. Offer Letter Notification WhatsApp Alert
   */
  async sendOfferLetterWhatsApp(toPhone, candidateName, { designation, offerUrl }) {
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
    const link = offerUrl || frontendUrl;

    const text = [
      `*Congratulations from WorkPulse!* 🎉`,
      `Dear ${candidateName},`,
      ``,
      `We are thrilled to offer you the position of *${designation}*!`,
      ``,
      `Please view your official offer letter and complete your onboarding here:`,
      `${link}`,
    ].join("\n");

    return await this.sendMessage({ to: toPhone, message: text });
  }
}

module.exports = new WhatsAppService();
