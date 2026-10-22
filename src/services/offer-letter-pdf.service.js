const PDFDocument = require("pdfkit");

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

const generateOfferLetterPdf = async ({ offer, companyName, companyLogoUrl }) => {
  const document = new PDFDocument({ size: "A4", margin: 54, info: {
    Title: `Offer Letter - ${offer.candidateName}`,
    Author: companyName || "WorkPulse",
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
  }

  document.font("Helvetica-Bold").fontSize(20).fillColor("#163b8f").text(companyName || "WorkPulse", 54, 108);
  document.font("Helvetica").fontSize(9).fillColor("#64748b").text("Workforce Systems", 54, 132);
  document.moveTo(54, 152).lineTo(541, 152).strokeColor("#dbe4f0").stroke();

  document.font("Helvetica-Bold").fontSize(18).fillColor("#111827").text("EMPLOYMENT OFFER LETTER", 54, 184, { align: "center" });
  document.font("Helvetica").fontSize(9).fillColor("#64748b").text(`Reference: ${offer.referenceNo || "WP-OFFER"}  |  Issued: ${dateText(offer.issuedDate)}`, 54, 214, { align: "center" });

  document.font("Helvetica").fontSize(11).fillColor("#1f2937").text(`Dear ${offer.candidateName || "Candidate"},`, 54, 264);
  document.moveDown(1);
  document.text(`We are pleased to offer you employment with ${companyName || "WorkPulse"}. We believe your skills and experience will be a valuable addition to our team.`);

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
  document.font("Helvetica-Bold").fontSize(11).fillColor("#163b8f").text("Offer details", 54, y);
  y += 24;
  rows.forEach(([label, value], index) => {
    if (index % 2 === 0) document.rect(54, y - 4, 487, 24).fill("#f5f8fc");
    document.font("Helvetica-Bold").fontSize(9).fillColor("#475569").text(label, 66, y + 3, { width: 175 });
    document.font("Helvetica").fontSize(9).fillColor("#111827").text(String(value || "-"), 250, y + 3, { width: 275 });
    y += 24;
  });

  y += 24;
  document.font("Helvetica-Bold").fontSize(11).fillColor("#163b8f").text("Terms and conditions", 54, y);
  y += 22;
  document.font("Helvetica").fontSize(9).fillColor("#374151");
  [
    `Probation period: ${offer.terms?.probationMonths || 3} months.`,
    `Notice period: ${offer.terms?.noticePeriodDays || 30} days after confirmation.`,
    `Working hours: ${offer.terms?.workingHours || "As per company policy"}.`,
    "This offer is subject to verification of the information and documents provided during onboarding.",
  ].forEach((line) => { document.text(`• ${line}`, 66, y, { width: 465 }); y += 18; });

  y += 18;
  document.font("Helvetica").fontSize(10).fillColor("#1f2937").text("Please review and accept this offer through the secure onboarding portal linked in the accompanying email.", 54, y, { width: 487, lineGap: 3 });
  y += 68;
  document.moveTo(54, y).lineTo(210, y).strokeColor("#94a3b8").stroke();
  document.fontSize(9).fillColor("#64748b").text("Authorized signatory", 54, y + 8);
  document.font("Helvetica-Bold").fontSize(9).fillColor("#163b8f").text(companyName || "WorkPulse", 380, y + 8, { width: 160, align: "right" });

  document.font("Helvetica").fontSize(8).fillColor("#94a3b8").text("This is a digitally generated offer letter. Please retain a copy for your records.", 54, 770, { align: "center", width: 487 });
  document.end();
  return completed;
};

module.exports = { generateOfferLetterPdf };
