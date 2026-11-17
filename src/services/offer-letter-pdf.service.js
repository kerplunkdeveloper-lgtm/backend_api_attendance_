const PDFDocument = require("pdfkit");
const { DEFAULT_OFFER_LETTER_TEMPLATE, normalizeOfferLetterTemplate } = require("../utils/offerLetterTemplate");

const money = (value) => {
  const amount = Number(value || 0);
  return `INR ${amount.toLocaleString("en-IN")}`;
};

const dateText = (value) => {
  if (!value) return "To be confirmed";
  return new Date(value).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
};

const fetchLogo = async (logoUrl) => {
  if (!/^https:\/\/[^\s"'<>]+$/i.test(String(logoUrl || ""))) return null;
  try {
    const response = await fetch(logoUrl);
    if (!response.ok) return null;
    const type = response.headers.get("content-type") || "";
    if (!type.startsWith("image/")) return null;
    return Buffer.from(await response.arrayBuffer());
  } catch {
    return null;
  }
};

const interpolateTemplate = (text, offer, companyName) => String(text || "")
  .replaceAll("{{candidateName}}", offer.candidateName || "Candidate")
  .replaceAll("{{employeeName}}", offer.candidateName || "Candidate")
  .replaceAll("{{employeeCode}}", offer.employeeCode || "To be confirmed")
  .replaceAll("{{email}}", offer.email || "To be confirmed")
  .replaceAll("{{phone}}", offer.phone || "To be confirmed")
  .replaceAll("{{currentAddress}}", offer.currentAddress || "Not specified")
  .replaceAll("{{companyName}}", companyName || "Clocked")
  .replaceAll("{{organizationName}}", offer.organizationName || companyName || "Clocked")
  .replaceAll("{{companyAddress}}", offer.companyAddress || "Company address not configured")
  .replaceAll("{{designation}}", offer.designation || "To be confirmed")
  .replaceAll("{{department}}", offer.department || "General")
  .replaceAll("{{workLocation}}", offer.branch || "Corporate Headquarters")
  .replaceAll("{{branch}}", offer.branch || "Corporate Headquarters")
  .replaceAll("{{joiningDate}}", dateText(offer.expectedJoinDate))
  .replaceAll("{{annualCtc}}", money(offer.compensation?.ctcAnnual || Number(offer.salary || 0) * 12))
  .replaceAll("{{monthlyCtc}}", money(offer.compensation?.grossMonthly || offer.salary))
  .replaceAll("{{basicMonthly}}", money(offer.compensation?.basicMonthly))
  .replaceAll("{{hraMonthly}}", money(offer.compensation?.hraMonthly))
  .replaceAll("{{specialAllowanceMonthly}}", money(offer.compensation?.specialAllowanceMonthly))
  .replaceAll("{{probationMonths}}", String(offer.terms?.probationMonths || 3))
  .replaceAll("{{noticePeriodDays}}", String(offer.terms?.noticePeriodDays || 30))
  .replaceAll("{{workingHours}}", offer.terms?.workingHours || "As per company policy")
  .replaceAll("{{issuedDate}}", dateText(offer.issuedDate))
  .replaceAll("{{referenceNo}}", offer.referenceNo || "WP-OFFER");

const generateOfferLetterPdf = async ({ offer, companyName, companyLogoUrl }) => {
  const template = normalizeOfferLetterTemplate(offer.template || DEFAULT_OFFER_LETTER_TEMPLATE);
  const interpolate = (text) => interpolateTemplate(text, offer, companyName);
  const document = new PDFDocument({ size: "A4", margin: 54, info: {
    Title: `Offer Letter - ${offer.candidateName}`,
    Author: companyName || "Clocked",
    Subject: "Employment Offer Letter",
  }});
  const chunks = [];
  document.on("data", (chunk) => chunks.push(chunk));

  const completed = new Promise((resolve, reject) => {
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
  });

  const logo = await fetchLogo(companyLogoUrl);
  if (logo) {
    try { document.image(logo, 54, 42, { fit: [150, 54], align: "left", valign: "center" }); } catch { /* text brand remains */ }
    try { document.save().opacity(0.035).image(logo, 205, 285, { fit: [180, 180], align: "center", valign: "center" }).restore(); } catch { /* watermark is optional */ }
  }

  document.font("Helvetica-Bold").fontSize(20).fillColor(template.primaryColor).text(companyName || "Clocked", 54, 108);
  document.font("Helvetica").fontSize(9).fillColor("#64748b").text(offer.companyAddress || "Company address not configured", 54, 132, { width: 487 });
  document.moveTo(54, 152).lineTo(541, 152).strokeColor("#dbe4f0").stroke();

  document.font("Helvetica-Bold").fontSize(18).fillColor(template.primaryColor).text(interpolate(template.title), 54, 184, { align: "center" });
  document.font("Helvetica").fontSize(9).fillColor("#64748b").text(`Reference: ${offer.referenceNo || "WP-OFFER"}  |  Issued: ${dateText(offer.issuedDate)}`, 54, 214, { align: "center" });

  document.font("Helvetica").fontSize(11).fillColor("#1f2937").text(interpolate(template.greeting), 54, 264);
  document.moveDown(1);
  document.text(interpolate(template.introduction));

  const rows = [
    ["Candidate", offer.candidateName],
    ["Designation", offer.designation || "To be confirmed"],
    ["Department", offer.department || "General"],
    ["Work location", offer.branch || "Corporate Headquarters"],
    ["Expected joining date", dateText(offer.expectedJoinDate)],
    ["Monthly CTC", money(offer.compensation?.grossMonthly || offer.salary)],
    ["Annual CTC", money(offer.compensation?.ctcAnnual || Number(offer.salary || 0) * 12)],
  ];

  let y = 350;
  document.font("Helvetica-Bold").fontSize(11).fillColor(template.primaryColor).text("Offer details", 54, y);
  y += 24;
  rows.forEach(([label, value], index) => {
    if (index % 2 === 0) document.rect(54, y - 4, 487, 24).fill("#f5f8fc");
    document.font("Helvetica-Bold").fontSize(9).fillColor("#475569").text(label, 66, y + 3, { width: 175 });
    document.font("Helvetica").fontSize(9).fillColor("#111827").text(String(value || "-"), 250, y + 3, { width: 275 });
    y += 24;
  });

  y += 24;
  document.font("Helvetica-Bold").fontSize(11).fillColor(template.primaryColor).text("Terms and conditions", 54, y);
  y += 22;
  document.font("Helvetica").fontSize(9).fillColor("#374151");
  template.terms.forEach((line) => { document.text(`• ${interpolate(line)}`, 66, y, { width: 465 }); y += 18; });

  y += 18;
  document.font("Helvetica").fontSize(10).fillColor("#1f2937").text("Please review and accept this offer through the secure onboarding portal linked in the accompanying email.", 54, y, { width: 487, lineGap: 3 });
  y += 68;
  document.moveTo(54, y).lineTo(210, y).strokeColor("#94a3b8").stroke();
  document.fontSize(9).fillColor("#64748b").text(template.signatoryTitle, 54, y + 8);
  document.font("Helvetica-Bold").fontSize(9).fillColor(template.primaryColor).text(template.signatoryName || companyName || "Clocked", 380, y + 8, { width: 160, align: "right" });

  document.font("Helvetica").fontSize(8).fillColor("#94a3b8").text(interpolate(template.footer), 54, 770, { align: "center", width: 487 });
  document.end();
  return completed;
};

module.exports = { generateOfferLetterPdf };
