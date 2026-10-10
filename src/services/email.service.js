const brevoService = require("./brevo.service");
const { generateOfferLetterPdf } = require("./offer-letter-pdf.service");

 const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);


const getEmailLogoUrl = (value) => {
  const raw = String(value || "").trim();
  if (!/^https:\/\/[^\s"'<>]+$/i.test(raw)) return null;
  if (/res\.cloudinary\.com\/[^/]+\/image\/upload\//i.test(raw)) {
    return raw.replace(
      /\/image\/upload\//i,
      "/image/upload/f_auto,q_auto,w_320,h_120,c_fit/",
    );
  }
  return raw;
};

const getInlineEmailLogo = async (value) => {
  const url = getEmailLogoUrl(value);
  if (!url) return null;
  try {
    const response = await fetch(url);
    if (!response.ok) return url;
    const contentType = response.headers.get("content-type") || "image/png";
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length <= 250 * 1024 && contentType.startsWith("image/")) {
      return `data:${contentType};base64,${bytes.toString("base64")}`;
    }
  } catch (error) {
    console.warn("[EmailService] Logo inline embedding skipped:", error.message);
  }
  return url;
};

class EmailService {
  constructor() {
    this.brevoService = brevoService;
  }

  /**
   * Generates modern, responsive WorkPulse HTML email template
   */
  async buildHtmlTemplate({ title, badge, badgeColor = "#2563eb", contentHtml, ctaText, ctaUrl, companyName, companyLogoUrl }) {
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
    const actionUrl = ctaUrl || frontendUrl;
    const displayCompanyName = escapeHtml(companyName || "WorkPulse");
    const safeLogoUrl = await getInlineEmailLogo(companyLogoUrl);
    const escapedLogoUrl = safeLogoUrl ? escapeHtml(safeLogoUrl) : null;
    const brandMark = safeLogoUrl
      ? `<img src="${escapedLogoUrl}" alt="${displayCompanyName} logo" width="240" height="90" style="width: 240px; height: 90px; object-fit: contain; margin: 0 auto 10px; display: block; background: #ffffff; border-radius: 10px; padding: 8px; border: 0;">`
      : `<div class="logo" style="font-size: 24px; font-weight: 800; letter-spacing: -0.5px; margin: 0 0 8px 0; color: #ffffff;">Work<span style="color: #60a5fa;">Pulse</span></div>`;

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
<body style="font-family: Arial, Helvetica, sans-serif; background-color: #f1f5f9; margin: 0; padding: 24px; color: #1e293b;">
  <div class="container" style="max-width: 580px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; border: 1px solid #e2e8f0;">
    <div class="header" style="background: #1e3a8a; padding: 32px 28px; text-align: center; color: #ffffff;">
      ${brandMark}
      <p class="header-sub" style="font-size: 13px; color: #bfdbfe; margin: 0; font-weight: 500;">${displayCompanyName} · Powered by WorkPulse</p>
    </div>
    <div class="body" style="padding: 32px 28px;">
      ${badge ? `<div class="badge" style="display: inline-block; padding: 6px 14px; border-radius: 9999px; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 20px; background-color: ${badgeColor}15; color: ${badgeColor}; border: 1px solid ${badgeColor}30;">${badge}</div>` : ""}
      <h1 class="heading" style="font-size: 20px; font-weight: 700; color: #0f172a; margin: 0 0 16px 0;">${title}</h1>
      ${contentHtml}
      ${ctaText ? `<div style="text-align: center; margin-top: 28px;"><a href="${actionUrl}" class="btn">${ctaText} &rarr;</a></div>` : ""}
    </div>
    <div class="footer" style="padding: 24px; background: #f8fafc; border-top: 1px solid #e2e8f0; text-align: center; font-size: 12px; color: #94a3b8; line-height: 1.5;">
      This is an automated notification from WorkPulse Workforce Systems.<br>
      © ${new Date().getFullYear()} WorkPulse Inc. All rights reserved.
    </div>
  </div>
</body>
</html>
    `.trim();
  }

  /**
   * Generic sender — Brevo transactional API live, simulation fallback outside production.
   */
  async sendEmail({ to, subject, html, text, attachments = [] }) {
    if (!to) {
      console.warn("[EmailService] No recipient address provided. Skipping.");
      return { success: false, message: "Recipient required" };
    }

    // 1. Try Brevo if ready
    if (this.brevoService && this.brevoService.isReady()) {
      try {
        const result = await this.brevoService.sendEmail({ to, subject, html, text, attachments });
        if (result.success) {
          console.log(`[EmailService:BREVO_LIVE] Sent email to ${to} via Brevo API (ID: ${result.id})`);
          return { success: true, live: true, provider: "BREVO", ...result };
        }
        console.warn(`[EmailService:BREVO_FAIL] Brevo dispatch failed for ${to}: ${result.error}.`);
        if (process.env.NODE_ENV === "production") {
          return { success: false, error: result.error, provider: "BREVO" };
        }
      } catch (err) {
        console.warn(`[EmailService:BREVO_ERROR] Brevo exception: ${err.message}.`);
        if (process.env.NODE_ENV === "production") {
          return { success: false, error: err.message, provider: "BREVO" };
        }
      }
    } else if (process.env.NODE_ENV === "production") {
      console.error("[EmailService] No live email provider is configured.");
      return {
        success: false,
        error: "Email delivery is not configured",
        provider: "UNAVAILABLE",
      };
    }

    // 2. Development-only simulation fallback
    console.log("────────────────────────────────────────────────────────────");
    console.log(`[EmailService:SIMULATION] Email to: ${to}`);
    console.log(`[EmailService:SIMULATION] Subject:  ${subject}`);
    console.log(`[EmailService:SIMULATION] Status:   Simulated (configure BREVO_API_KEY for live dispatch)`);
    console.log("────────────────────────────────────────────────────────────");

    return {
      success: true,
      simulated: true,
      provider: "SIMULATION",
      message: "Email logged in simulation mode",
      to,
      subject,
    };
  }

  /**
   * 1. Leave Request Status Email (Approved or Rejected)
   */
  async sendLeaveStatusEmail(to, employeeName, { status, leaveType, startDate, endDate, totalDays, reviewNote, reviewerName, companyName, companyLogoUrl }) {
    employeeName = escapeHtml(employeeName);
    leaveType = escapeHtml(leaveType);
    reviewNote = reviewNote ? escapeHtml(reviewNote) : reviewNote;
    reviewerName = reviewerName ? escapeHtml(reviewerName) : reviewerName;
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

    const html = await this.buildHtmlTemplate({
      title: `Leave Request ${statusText}`,
      badge: `Leave ${statusText}`,
      badgeColor,
      contentHtml,
      ctaText: "View Leave Status",
      ctaUrl: `${process.env.FRONTEND_URL || "http://localhost:3000"}/leaves`,
      companyName,
      companyLogoUrl,
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
  async sendPayslipDisbursedEmail(to, employeeName, { month, year, netSalary, grossSalary, deductionsTotal, workingDays, presentDays, companyName, companyLogoUrl }) {
    employeeName = escapeHtml(employeeName);
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

    const html = await this.buildHtmlTemplate({
      title: `Payslip Disbursed — ${monthName} ${year}`,
      badge: "Salary Disbursed",
      badgeColor: "#10b981",
      contentHtml,
      ctaText: "Download Payslip PDF",
      ctaUrl: `${process.env.FRONTEND_URL || "http://localhost:3000"}/payroll`,
      companyName,
      companyLogoUrl,
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
  async sendShiftReminderEmail(to, employeeName, { shiftName, shiftTime, punchUrl, companyName, companyLogoUrl }) {
    employeeName = escapeHtml(employeeName);
    shiftName = escapeHtml(shiftName);
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

    const html = await this.buildHtmlTemplate({
      title: "Daily Attendance Reminder",
      badge: "Punch In Reminder",
      badgeColor: "#f59e0b",
      contentHtml,
      ctaText: "Clock In Now",
      ctaUrl: punchUrl || `${process.env.FRONTEND_URL || "http://localhost:3000"}`,
      companyName,
      companyLogoUrl,
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
  async sendOfferLetterEmail(to, candidateName, { designation, department, expectedJoinDate, salary, offerUrl, companyName, companyLogoUrl, offerLetterData }) {
    candidateName = escapeHtml(candidateName);
    department = escapeHtml(department);
    const rawDesignation = designation;
    designation = escapeHtml(designation);
    const joinDateStr = expectedJoinDate
      ? new Date(expectedJoinDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
      : "To be confirmed";

    const offer = offerLetterData || {
      candidateName,
      designation,
      department,
      expectedJoinDate,
      salary,
    };
    const offerName = escapeHtml(offer.candidateName || candidateName);
    const offerDesignation = escapeHtml(offer.designation || designation || "To be confirmed");
    const offerDepartment = escapeHtml(offer.department || department || "General");
    const offerBranch = escapeHtml(offer.branch || "Corporate Headquarters");
    const offerReference = escapeHtml(offer.referenceNo || "WP-OFFER");
    const monthlyCtc = offer.compensation?.grossMonthly || offer.salary || salary;
    const annualCtc = offer.compensation?.ctcAnnual || (Number(monthlyCtc || 0) * 12);
    const probation = offer.terms?.probationMonths || 3;
    const noticePeriod = offer.terms?.noticePeriodDays || 30;
    const workingHours = escapeHtml(offer.terms?.workingHours || "As per company policy");

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
      <h2 style="font-size: 16px; color: #163b8f; margin: 28px 0 12px;">Complete offer details</h2>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 18px 20px; margin: 16px 0;">
        <p style="font-size: 14px; color: #475569; margin: 6px 0;">Offer reference: <strong>${offerReference}</strong></p>
        <p style="font-size: 14px; color: #475569; margin: 6px 0;">Candidate: <strong>${offerName}</strong></p>
        <p style="font-size: 14px; color: #475569; margin: 6px 0;">Designation: <strong>${offerDesignation}</strong></p>
        <p style="font-size: 14px; color: #475569; margin: 6px 0;">Department: <strong>${offerDepartment}</strong></p>
        <p style="font-size: 14px; color: #475569; margin: 6px 0;">Work location: <strong>${offerBranch}</strong></p>
        <p style="font-size: 14px; color: #475569; margin: 6px 0;">Joining date: <strong>${joinDateStr}</strong></p>
        <p style="font-size: 14px; color: #475569; margin: 6px 0;">Monthly CTC: <strong>INR ${Number(monthlyCtc || 0).toLocaleString("en-IN")}</strong></p>
        <p style="font-size: 14px; color: #475569; margin: 6px 0;">Annual CTC: <strong>INR ${Number(annualCtc || 0).toLocaleString("en-IN")}</strong></p>
      </div>
      <h2 style="font-size: 16px; color: #163b8f; margin: 28px 0 12px;">Terms and conditions</h2>
      <ul style="font-size: 14px; line-height: 1.7; color: #475569; padding-left: 20px; margin: 0 0 20px;">
        <li>Probation period: ${probation} months.</li>
        <li>Notice period: ${noticePeriod} days after confirmation.</li>
        <li>Working hours: ${workingHours}.</li>
        <li>This offer is subject to verification of the information and documents provided.</li>
      </ul>
      <p class="text" style="font-size: 13px; line-height: 1.6; color: #64748b; margin: 20px 0 0;">
        Your complete offer letter is attached as a PDF. The secure portal button is only required to accept the offer and complete onboarding.
      </p>
    `;

    const html = await this.buildHtmlTemplate({
      title: "Congratulations on your Job Offer!",
      badge: "Official Job Offer",
      badgeColor: "#8b5cf6",
      contentHtml,
      ctaText: offerUrl ? "Accept Offer Securely" : null,
      ctaUrl: offerUrl,
      companyName,
      companyLogoUrl,
    });

    const pdf = await generateOfferLetterPdf({ offer, companyName, companyLogoUrl });

    return await this.sendEmail({
      to,
      subject: `[WorkPulse] Job Offer: ${rawDesignation} at WorkPulse`,
      html,
      attachments: [{
        content: pdf.toString("base64"),
        name: `Offer_Letter_${String(candidateName).replace(/[^a-z0-9]+/gi, "_")}.pdf`,
      }],
    });
  }

  /**
   * 5. Plan Unlock Code Email — sent to admin after registration
   * Contains the code they must enter in the dashboard to activate their plan.
   */
  async sendUnlockCodeEmail(to, adminName, { organizationName, unlockCode, plan, loginUrl, companyLogoUrl }) {
    adminName = escapeHtml(adminName);
    organizationName = escapeHtml(organizationName);
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

    const html = await this.buildHtmlTemplate({
      title: "Your WorkPulse Plan Unlock Code",
      badge: "Plan Activation Required",
      badgeColor: "#2563eb",
      contentHtml,
      ctaText: "Login & Activate Now",
      ctaUrl: loginUrl || `${process.env.FRONTEND_URL || "http://localhost:3000"}/login`,
      companyName: organizationName,
      companyLogoUrl,
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
  async sendEmployeeWelcomeEmail(to, firstName, { organizationName, tempPassword, loginUrl, role, companyLogoUrl }) {
    const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
    firstName = esc(firstName);
    const rawOrganizationName = organizationName;
    organizationName = esc(organizationName);
    role = esc({ MANAGER: "HR", COMPANY_ADMIN: "Company admin", EMPLOYEE: "Employee" }[role] || role);
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

    const html = await this.buildHtmlTemplate({
      title: `Welcome to ${organizationName} on WorkPulse!`,
      badge: "Account Created",
      badgeColor: "#10b981",
      contentHtml,
      ctaText: "Login to WorkPulse",
      ctaUrl: loginUrl || `${process.env.FRONTEND_URL || "http://localhost:3000"}/login`,
      companyName: rawOrganizationName,
      companyLogoUrl,
    });

    return await this.sendEmail({
      to,
      subject: `[WorkPulse] Your login credentials for ${rawOrganizationName}`,
      html,
    });
  }

  /**
   * 7. Password Reset Email — sent when user requests password reset
   */
  async sendPasswordResetEmail(to, userName, { resetUrl, expiresIn = "60 minutes", companyName, companyLogoUrl }) {
    userName = escapeHtml(userName);
    const contentHtml = `
      <p class="text" style="font-size: 15px; line-height: 1.6; color: #475569; margin: 0 0 20px 0;">Hello <strong>${userName || "WorkPulse User"}</strong>,</p>
      <p class="text" style="font-size: 15px; line-height: 1.6; color: #475569; margin: 0 0 20px 0;">
        We received a request to reset the password for your WorkPulse enterprise account. If you made this request, click the button below to choose a new password:
      </p>
      <div style="text-align: center; margin: 28px 0;">
        <a href="${resetUrl}" class="btn" style="background: #4f46e5; color: #ffffff !important; font-weight: 700; padding: 14px 32px; border-radius: 12px; text-decoration: none; display: inline-block;">Reset Password &rarr;</a>
      </div>
      <div class="info-card" style="background: #f8fafc; border-radius: 12px; border: 1px solid #e2e8f0; padding: 18px 20px; margin: 20px 0;">
        <div class="info-row" style="padding: 6px 0; border-bottom: 1px dashed #e2e8f0; font-size: 14px;"><span class="info-label" style="color: #64748b; font-weight: 500;">Account:</span><span class="info-value" style="color: #0f172a; font-weight: 600; text-align: right; font-family: monospace;">${to}</span></div>
        <div class="info-row" style="padding: 6px 0; border-bottom: 1px dashed #e2e8f0; font-size: 14px;"><span class="info-label" style="color: #64748b; font-weight: 500;">Expires In:</span><span class="info-value" style="color: #f59e0b; font-weight: 600; text-align: right;">${expiresIn}</span></div>
        <div class="info-row" style="padding: 6px 0; font-size: 14px;"><span class="info-label" style="color: #64748b; font-weight: 500;">Security:</span><span class="info-value" style="color: #10b981; font-weight: 600; text-align: right;">Single-Use Protected</span></div>
      </div>
      <p class="text" style="font-size: 13px; color: #64748b;">
        If the button doesn't work, copy and paste this link into your browser:<br>
        <a href="${resetUrl}" style="color: #4f46e5; word-break: break-all; font-size: 12px;">${resetUrl}</a>
      </p>
      <p class="text" style="font-size: 12px; color: #94a3b8; margin-top: 20px; border-top: 1px dashed #cbd5e1; padding-top: 16px;">
        ⚠️ If you did not request a password reset, you can safely ignore this email. Your current password remains secure and active.
      </p>
    `;

    const html = await this.buildHtmlTemplate({
      title: "Reset Your WorkPulse Password",
      badge: "Password Reset",
      badgeColor: "#4f46e5",
      contentHtml,
      // The reset button is already included in contentHtml. Keeping only one
      // CTA avoids duplicate buttons in clients that strip the head stylesheet.
      ctaText: null,
      ctaUrl: resetUrl,
      companyName,
      companyLogoUrl,
    });

    return await this.sendEmail({
      to,
      subject: `[WorkPulse] Password Reset Request`,
      html,
    });
  }

  /**
   * Verify communication connection status (Brevo)
   */
  async verifyConnection() {
    const brevoStatus = {
      configured: this.brevoService ? this.brevoService.isReady() : false,
      provider: "Brevo Transactional Email API",
      fromEmail: process.env.BREVO_FROM_EMAIL || "onboarding@workpulse.com",
    };

    return {
      activeProvider: brevoStatus.configured ? "BREVO" : "SIMULATION",
      brevo: brevoStatus,
    };
  }

  /**
   * 8. Signup Email Verification Code
   */
  async sendVerificationEmail(to, userName, { code, expiresIn = "15 minutes", companyName, companyLogoUrl } = {}) {
    userName = escapeHtml(userName);
    const contentHtml = `
      <p class="text">Hello <strong>${userName || "there"}</strong>,</p>
      <p class="text">
        Thanks for signing up for <strong>WorkPulse</strong>! Enter the verification code below to confirm your email address and activate your account.
      </p>
      <div class="info-card" style="text-align: center; padding: 28px;">
        <p style="margin: 0 0 8px; font-size: 13px; color: #64748b; font-weight: 500; text-transform: uppercase; letter-spacing: 1px;">Your Verification Code</p>
        <div style="font-size: 32px; font-weight: 800; letter-spacing: 8px; color: #2563eb; font-family: 'Courier New', monospace; background: #eff6ff; border: 2px dashed #bfdbfe; border-radius: 10px; padding: 16px 24px; display: inline-block;">
          ${code}
        </div>
        <p style="margin: 12px 0 0; font-size: 12px; color: #94a3b8;">This code expires in ${expiresIn}.</p>
      </div>
      <p class="text" style="font-size: 13px; color: #64748b;">
        If you did not create a WorkPulse account, you can safely ignore this email.
      </p>
    `;

    const html = await this.buildHtmlTemplate({
      title: "Verify Your Email Address",
      badge: "Email Verification",
      badgeColor: "#2563eb",
      contentHtml,
      companyName,
      companyLogoUrl,
    });

    return await this.sendEmail({
      to,
      subject: `[WorkPulse] Your verification code is ${code}`,
      html,
    });
  }
}
module.exports = new EmailService();
