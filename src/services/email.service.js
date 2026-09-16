const nodemailer = require("nodemailer");

class EmailService {
  constructor() {
    this.isConfigured = false;
    this.transporter = null;
    this.initTransporter();
  }

  initTransporter() {
    const host = process.env.SMTP_HOST || "smtp.gmail.com";
    const port = parseInt(process.env.SMTP_PORT) || 587;
    const secure = process.env.SMTP_SECURE === "true" || port === 465;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    if (user && pass) {
      try {
        this.transporter = nodemailer.createTransport({
          host,
          port,
          secure,
          auth: { user, pass },
          tls: { rejectUnauthorized: false },
        });
        this.isConfigured = true;
        console.log(`[EmailService] Initialized live SMTP transport (${host}:${port})`);
      } catch (err) {
        console.warn(`[EmailService] Failed to initialize live transport: ${err.message}. Falling back to simulation mode.`);
        this.isConfigured = false;
      }
    } else {
      this.isConfigured = false;
    }
  }

  /**
   * Generates modern, responsive WorkPulse HTML email template
   */
  buildHtmlTemplate({ title, badge, badgeColor = "#2563eb", contentHtml, ctaText, ctaUrl }) {
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
    const actionUrl = ctaUrl || frontendUrl;

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f1f5f9; margin: 0; padding: 24px; color: #1e293b; }
    .container { max-width: 580px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.06); border: 1px solid #e2e8f0; }
    .header { background: linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%); padding: 32px 28px; text-align: center; color: #ffffff; }
    .logo { font-size: 24px; font-weight: 800; letter-spacing: -0.5px; margin: 0 0 8px 0; }
    .logo span { color: #60a5fa; }
    .header-sub { font-size: 13px; color: #bfdbfe; margin: 0; font-weight: 500; }
    .body { padding: 32px 28px; }
    .badge { display: inline-block; padding: 6px 14px; border-radius: 9999px; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 20px; background-color: ${badgeColor}15; color: ${badgeColor}; border: 1px solid ${badgeColor}30; }
    .heading { font-size: 20px; font-weight: 700; color: #0f172a; margin: 0 0 16px 0; }
    .text { font-size: 15px; line-height: 1.6; color: #475569; margin: 0 0 20px 0; }
    .info-card { background-color: #f8fafc; border-radius: 12px; border: 1px solid #e2e8f0; padding: 18px 20px; margin: 20px 0; }
    .info-row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px dashed #e2e8f0; font-size: 14px; }
    .info-row:last-child { border-bottom: none; }
    .info-label { color: #64748b; font-weight: 500; }
    .info-value { color: #0f172a; font-weight: 600; text-align: right; }
    .btn { display: inline-block; background: #2563eb; color: #ffffff !important; text-decoration: none; padding: 14px 28px; border-radius: 10px; font-weight: 600; font-size: 15px; margin-top: 10px; box-shadow: 0 4px 12px rgba(37,99,235,0.25); text-align: center; }
    .footer { padding: 24px; background: #f8fafc; border-top: 1px solid #e2e8f0; text-align: center; font-size: 12px; color: #94a3b8; line-height: 1.5; }
    .footer a { color: #64748b; text-decoration: underline; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">Work<span>Pulse</span></div>
      <p class="header-sub">Enterprise Workforce & Attendance Management</p>
    </div>
    <div class="body">
      ${badge ? `<div class="badge">${badge}</div>` : ""}
      <h1 class="heading">${title}</h1>
      ${contentHtml}
      ${ctaText ? `<div style="text-align: center; margin-top: 28px;"><a href="${actionUrl}" class="btn">${ctaText} &rarr;</a></div>` : ""}
    </div>
    <div class="footer">
      This is an automated notification from WorkPulse Workforce Systems.<br>
      © ${new Date().getFullYear()} WorkPulse Inc. All rights reserved.
    </div>
  </div>
</body>
</html>
    `.trim();
  }

  /**
   * Generic sender with mock/simulation fallback
   */
  async sendEmail({ to, subject, html, text }) {
    if (!to) {
      console.warn("[EmailService] No recipient address provided. Skipping.");
      return { success: false, message: "Recipient required" };
    }

    const from = process.env.EMAIL_FROM || "WorkPulse Notifications <notifications@workpulse.com>";

    if (this.isConfigured && this.transporter) {
      try {
        const info = await this.transporter.sendMail({
          from,
          to,
          subject,
          text: text || "WorkPulse notification",
          html,
        });
        console.log(`[EmailService:LIVE] Sent email to ${to} (MessageId: ${info.messageId})`);
        return { success: true, live: true, messageId: info.messageId };
      } catch (err) {
        console.error(`[EmailService:LIVE_FAIL] Failed to send email to ${to}:`, err.message);
        return { success: false, error: err.message };
      }
    }

    // Simulation / Dev Fallback
    console.log("────────────────────────────────────────────────────────────");
    console.log(`[EmailService:SIMULATION] Email to: ${to}`);
    console.log(`[EmailService:SIMULATION] Subject:  ${subject}`);
    console.log(`[EmailService:SIMULATION] Status:   Simulated (Configure SMTP_USER & SMTP_PASS in .env for live dispatch)`);
    console.log("────────────────────────────────────────────────────────────");

    return {
      success: true,
      simulated: true,
      message: "Email logged in simulation mode (SMTP not yet configured)",
      to,
      subject,
    };
  }

  /**
   * 1. Leave Request Status Email (Approved or Rejected)
   */
  async sendLeaveStatusEmail(to, employeeName, { status, leaveType, startDate, endDate, totalDays, reviewNote, reviewerName }) {
    const isApproved = status === "APPROVED";
    const badgeColor = isApproved ? "#10b981" : "#ef4444";
    const statusText = isApproved ? "Approved" : "Rejected";

    const startStr = new Date(startDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
    const endStr = new Date(endDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

    const contentHtml = `
      <p class="text">Hello <strong>${employeeName}</strong>,</p>
      <p class="text">
        Your leave request for <strong>${totalDays} day(s)</strong> has been <strong style="color: ${badgeColor};">${statusText}</strong> by HR Management.
      </p>
      <div class="info-card">
        <div class="info-row"><span class="info-label">Leave Type:</span><span class="info-value">${leaveType || "Casual Leave"}</span></div>
        <div class="info-row"><span class="info-label">Duration:</span><span class="info-value">${totalDays} Day(s)</span></div>
        <div class="info-row"><span class="info-label">Dates:</span><span class="info-value">${startStr} &mdash; ${endStr}</span></div>
        <div class="info-row"><span class="info-label">Status:</span><span class="info-value" style="color: ${badgeColor};">${statusText}</span></div>
        ${reviewNote ? `<div class="info-row"><span class="info-label">Remarks:</span><span class="info-value">${reviewNote}</span></div>` : ""}
      </div>
      <p class="text" style="font-size: 13px; color: #64748b;">
        ${isApproved ? "Your attendance calendar has been synchronized automatically." : "If you have questions, please reach out to your manager."}
      </p>
    `;

    const html = this.buildHtmlTemplate({
      title: `Leave Request ${statusText}`,
      badge: `Leave ${statusText}`,
      badgeColor,
      contentHtml,
      ctaText: "View Leave Status",
      ctaUrl: `${process.env.FRONTEND_URL || "http://localhost:3000"}/leaves`,
    });

    return await this.sendEmail({
      to,
      subject: `[WorkPulse] Leave Request ${statusText} (${startStr} - ${endStr})`,
      html,
    });
  }

  /**
   * 2. Monthly Payslip Disbursed Notification Email
   */
  async sendPayslipDisbursedEmail(to, employeeName, { month, year, netSalary, grossSalary, deductionsTotal, workingDays, presentDays }) {
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const monthName = monthNames[(parseInt(month) || 1) - 1];

    const contentHtml = `
      <p class="text">Hello <strong>${employeeName}</strong>,</p>
      <p class="text">
        Your monthly salary for <strong>${monthName} ${year}</strong> has been calculated and <strong style="color: #10b981;">Disbursed</strong>.
      </p>
      <div class="info-card">
        <div class="info-row"><span class="info-label">Payroll Period:</span><span class="info-value">${monthName} ${year}</span></div>
        <div class="info-row"><span class="info-label">Days Present:</span><span class="info-value">${presentDays || 0} / ${workingDays || 26}</span></div>
        <div class="info-row"><span class="info-label">Gross Earnings:</span><span class="info-value">₹${Number(grossSalary || 0).toLocaleString("en-IN")}</span></div>
        <div class="info-row"><span class="info-label">Total Deductions:</span><span class="info-value" style="color: #ef4444;">-₹${Number(deductionsTotal || 0).toLocaleString("en-IN")}</span></div>
        <div class="info-row" style="font-size: 16px; border-top: 2px solid #cbd5e1; padding-top: 10px;">
          <span class="info-label" style="font-weight: 700; color: #0f172a;">Net Salary Disbursed:</span>
          <span class="info-value" style="color: #10b981; font-weight: 800; font-size: 18px;">₹${Number(netSalary || 0).toLocaleString("en-IN")}</span>
        </div>
      </div>
      <p class="text" style="font-size: 13px; color: #64748b;">
        You can download your complete PDF payslip with company letterhead by logging into your portal.
      </p>
    `;

    const html = this.buildHtmlTemplate({
      title: `Payslip Disbursed — ${monthName} ${year}`,
      badge: "Salary Disbursed",
      badgeColor: "#10b981",
      contentHtml,
      ctaText: "Download Payslip PDF",
      ctaUrl: `${process.env.FRONTEND_URL || "http://localhost:3000"}/payroll`,
    });

    return await this.sendEmail({
      to,
      subject: `[WorkPulse] Salary Payslip Disbursed for ${monthName} ${year}`,
      html,
    });
  }

  /**
   * 3. Morning Shift Check-in Reminder Email
   */
  async sendShiftReminderEmail(to, employeeName, { shiftName, shiftTime, punchUrl }) {
    const contentHtml = `
      <p class="text">Good morning <strong>${employeeName}</strong> 👋,</p>
      <p class="text">
        This is a friendly reminder that your work shift begins in a few minutes. Don't forget to punch in to mark your attendance on time!
      </p>
      <div class="info-card">
        <div class="info-row"><span class="info-label">Shift Name:</span><span class="info-value">${shiftName || "General Shift"}</span></div>
        <div class="info-row"><span class="info-label">Start Time:</span><span class="info-value">${shiftTime || "09:00 AM"}</span></div>
        <div class="info-row"><span class="info-label">Status:</span><span class="info-value" style="color: #f59e0b;">Pending Clock-In</span></div>
      </div>
      <p class="text" style="font-size: 13px; color: #64748b;">
        Punch in easily from your mobile browser or desktop. GPS Geofence verification applies.
      </p>
    `;

    const html = this.buildHtmlTemplate({
      title: "Daily Attendance Reminder",
      badge: "Punch In Reminder",
      badgeColor: "#f59e0b",
      contentHtml,
      ctaText: "Clock In Now",
      ctaUrl: punchUrl || `${process.env.FRONTEND_URL || "http://localhost:3000"}`,
    });

    return await this.sendEmail({
      to,
      subject: `[WorkPulse] Reminder: Your shift starts at ${shiftTime || "09:00 AM"}`,
      html,
    });
  }

  /**
   * 4. Candidate Offer Letter Notification Email
   */
  async sendOfferLetterEmail(to, candidateName, { designation, department, expectedJoinDate, salary, offerUrl }) {
    const joinDateStr = expectedJoinDate
      ? new Date(expectedJoinDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
      : "To be confirmed";

    const contentHtml = `
      <p class="text">Dear <strong>${candidateName}</strong>,</p>
      <p class="text">
        Congratulations! We are delighted to extend an official job offer for the position of <strong>${designation}</strong>.
      </p>
      <div class="info-card">
        <div class="info-row"><span class="info-label">Designation:</span><span class="info-value">${designation}</span></div>
        <div class="info-row"><span class="info-label">Department:</span><span class="info-value">${department || "General"}</span></div>
        <div class="info-row"><span class="info-label">Expected Joining:</span><span class="info-value">${joinDateStr}</span></div>
        ${salary ? `<div class="info-row"><span class="info-label">Monthly CTC:</span><span class="info-value">₹${Number(salary).toLocaleString("en-IN")}</span></div>` : ""}
      </div>
      <p class="text">
        Please access your dedicated onboarding portal to review the complete offer terms, upload any required onboarding documents, and accept the offer.
      </p>
    `;

    const html = this.buildHtmlTemplate({
      title: "Congratulations on your Job Offer!",
      badge: "Official Job Offer",
      badgeColor: "#8b5cf6",
      contentHtml,
      ctaText: "View & Accept Offer Letter",
      ctaUrl: offerUrl || `${process.env.FRONTEND_URL || "http://localhost:3000"}`,
    });

    return await this.sendEmail({
      to,
      subject: `[WorkPulse] Job Offer: ${designation} at WorkPulse`,
      html,
    });
  }

  /**
   * 5. Plan Unlock Code Email — sent to admin after registration
   * Contains the code they must enter in the dashboard to activate their plan.
   */
  async sendUnlockCodeEmail(to, adminName, { organizationName, unlockCode, plan, loginUrl }) {
    const contentHtml = `
      <p class="text">Hello <strong>${adminName || "Admin"}</strong>,</p>
      <p class="text">
        Welcome to <strong>WorkPulse</strong>! Your organization <strong>${organizationName}</strong> has been registered successfully.
        To activate your <strong>${plan || "FREE_TRIAL"}</strong> plan and unlock your full dashboard, please enter the activation code below.
      </p>
      <div class="info-card" style="text-align: center; padding: 28px;">
        <p style="margin: 0 0 8px; font-size: 13px; color: #64748b; font-weight: 500; text-transform: uppercase; letter-spacing: 1px;">Your Plan Unlock Code</p>
        <div style="font-size: 28px; font-weight: 800; letter-spacing: 6px; color: #2563eb; font-family: 'Courier New', monospace; background: #eff6ff; border: 2px dashed #bfdbfe; border-radius: 10px; padding: 16px 24px; display: inline-block;">
          ${unlockCode}
        </div>
        <p style="margin: 12px 0 0; font-size: 12px; color: #94a3b8;">This code is unique to your organization. Keep it safe.</p>
      </div>
      <div class="info-card">
        <div class="info-row"><span class="info-label">Organization:</span><span class="info-value">${organizationName}</span></div>
        <div class="info-row"><span class="info-label">Plan:</span><span class="info-value">${plan || "FREE TRIAL"}</span></div>
        <div class="info-row"><span class="info-label">Admin Email:</span><span class="info-value">${to}</span></div>
      </div>
      <p class="text" style="font-size: 13px; color: #64748b;">
        <strong>How to activate:</strong><br>
        1. Login at <a href="${loginUrl}" style="color: #2563eb;">${loginUrl}</a><br>
        2. You'll see a 🔒 locked banner on your dashboard<br>
        3. Click "Enter Unlock Code" and paste the code above
      </p>
    `;

    const html = this.buildHtmlTemplate({
      title: "Your WorkPulse Plan Unlock Code",
      badge: "Plan Activation Required",
      badgeColor: "#2563eb",
      contentHtml,
      ctaText: "Login & Activate Now",
      ctaUrl: loginUrl || `${process.env.FRONTEND_URL || "http://localhost:3000"}/login`,
    });

    return await this.sendEmail({
      to,
      subject: `[WorkPulse] Your Plan Unlock Code — ${unlockCode}`,
      html,
    });
  }

  /**
   * 6. Employee Welcome Email — sent when admin invites an employee by email.
   * Contains their auto-generated login credentials.
   */
  async sendEmployeeWelcomeEmail(to, firstName, { organizationName, tempPassword, loginUrl, role }) {
    const contentHtml = `
      <p class="text">Hello <strong>${firstName}</strong>,</p>
      <p class="text">
        You have been added to <strong>${organizationName}</strong>'s WorkPulse attendance management system
        as a <strong>${role || "Employee"}</strong>.
        Your login credentials are ready — please sign in and change your password on first login.
      </p>
      <div class="info-card">
        <div class="info-row"><span class="info-label">Login Email:</span><span class="info-value" style="font-family: monospace;">${to}</span></div>
        <div class="info-row">
          <span class="info-label">Temporary Password:</span>
          <span class="info-value" style="font-family: monospace; color: #dc2626; background: #fef2f2; padding: 2px 8px; border-radius: 6px; border: 1px solid #fecaca;">
            ${tempPassword}
          </span>
        </div>
        <div class="info-row"><span class="info-label">Organization:</span><span class="info-value">${organizationName}</span></div>
        <div class="info-row"><span class="info-label">Role:</span><span class="info-value">${role || "Employee"}</span></div>
      </div>
      <p class="text" style="font-size: 13px; color: #ef4444; font-weight: 600;">
        ⚠️ You will be prompted to set a new password when you first log in. Your temporary password will expire after first use.
      </p>
      <p class="text" style="font-size: 13px; color: #64748b;">
        Use the WorkPulse app or web portal to mark your daily attendance, view payslips, apply for leaves, and more.
      </p>
    `;

    const html = this.buildHtmlTemplate({
      title: `Welcome to ${organizationName} on WorkPulse!`,
      badge: "Account Created",
      badgeColor: "#10b981",
      contentHtml,
      ctaText: "Login to WorkPulse",
      ctaUrl: loginUrl || `${process.env.FRONTEND_URL || "http://localhost:3000"}/login`,
    });

    return await this.sendEmail({
      to,
      subject: `[WorkPulse] Your login credentials for ${organizationName}`,
      html,
    });
  }

  /**
   * Verify SMTP connection status
   */
  async verifyConnection() {
    if (!this.transporter || !this.isConfigured) {
      return {
        configured: false,
        message: "SMTP is running in Simulation Mode (Set SMTP_USER and SMTP_PASS in .env to enable live dispatch).",
      };
    }
    try {
      await this.transporter.verify();
      return { configured: true, message: "SMTP server connected and verified successfully." };
    } catch (err) {
      return { configured: false, error: err.message };
    }
  }
}

module.exports = new EmailService();

