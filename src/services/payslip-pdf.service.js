const PDFDocument = require("pdfkit");

const formatInr = (value) => {
  const n = Number(value || 0);
  const formatted = Math.abs(n).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${n < 0 ? "- " : ""}INR ${formatted}`;
};

const formatDate = (value) => {
  if (!value) return "N/A";
  return new Date(value).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

const fetchLogo = async (logoUrl) => {
  if (!/^https?:\/\/[^\s"'<>]+$/i.test(String(logoUrl || ""))) return null;
  try {
    const res = await fetch(logoUrl);
    if (!res.ok) return null;
    const type = res.headers.get("content-type") || "";
    if (!type.startsWith("image/")) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
};

/**
 * Generates an executive A4 Payslip PDF using PDFKit
 * @param {object} details - Complete payslip details object from payrollService.getPayslipDetails
 * @returns {Promise<Buffer>}
 */
async function generatePayslipPdf(details) {
  return new Promise(async (resolve, reject) => {
    const PAGE_W = 595.28;
    const PAGE_H = 841.89;
    const M = 36; // 36pt margins
    const L = M;
    const R = PAGE_W - M;
    const W = R - L;

    // Palette
    const primaryColor = details.template?.primaryColor || "#4338ca";
    const C = {
      primary: primaryColor,
      ink: "#0f172a",
      body: "#334155",
      muted: "#64748b",
      border: "#e2e8f0",
      softBg: "#f8fafc",
      success: "#059669",
      successBg: "#ecfdf5",
      danger: "#dc2626",
      dangerBg: "#fef2f2",
      headerText: "#ffffff",
    };

    const doc = new PDFDocument({
      size: "A4",
      margin: 0,
      info: {
        Title: `Payslip - ${details.employee?.name || "Employee"} - ${details.period?.periodLabel || ""}`,
        Author: details.organization?.name || "WorkPluse",
        Subject: "Monthly Salary Payslip",
      },
    });

    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const text = (val, x, y, opts = {}) =>
      doc.text(String(val ?? ""), x, y, { lineBreak: false, ...opts });

    // Optional company logo
    let logoBuf = null;
    if (details.organization?.logoUrl) {
      logoBuf = await fetchLogo(details.organization.logoUrl);
    }

    // ── 1. Top Header Banner ──────────────────────────────────────────
    doc.rect(0, 0, PAGE_W, 90).fill(C.primary);

    let orgX = L;
    if (logoBuf) {
      try {
        doc.image(logoBuf, L, 18, { fit: [54, 54] });
        orgX = L + 62;
      } catch {
        // Logo decoding fallback
      }
    }

    const orgName = details.organization?.name || "WorkPluse Enterprise";
    doc.font("Helvetica-Bold").fontSize(16).fillColor("#ffffff");
    text(orgName, orgX, 22, { width: 300, ellipsis: true });

    doc.font("Helvetica").fontSize(8.5).fillColor("#e0e7ff");
    const address = details.organization?.address || "Corporate Campus";
    text(address, orgX, 42, { width: 310, ellipsis: true });

    if (details.organization?.taxIdentifierValue) {
      text(
        `${details.organization.taxIdentifierLabel || "Tax ID"}: ${details.organization.taxIdentifierValue}`,
        orgX,
        56,
        { width: 310, ellipsis: true }
      );
    }

    // Top Right: Payslip Title & Period
    doc.font("Helvetica-Bold").fontSize(14).fillColor("#ffffff");
    text("SALARY PAYSLIP", L, 22, { width: W, align: "right" });

    doc.font("Helvetica").fontSize(10).fillColor("#e0e7ff");
    text(details.period?.periodLabel || "Monthly Pay", L, 40, { width: W, align: "right" });

    doc.font("Helvetica").fontSize(8).fillColor("#c7d2fe");
    text(`Ref: ${details.referenceNo || "WP-PAY"}`, L, 56, { width: W, align: "right" });

    // ── 2. Status & Reference Pill ──────────────────────────────────
    let curY = 100;
    const status = String(details.governance?.status || "APPROVED").toUpperCase();
    const isPaid = status === "PAID" || status === "DISBURSED";
    const pillBg = isPaid ? C.successBg : "#fef3c7";
    const pillTextColor = isPaid ? C.success : "#d97706";

    doc.roundedRect(R - 90, curY, 90, 18, 9).fill(pillBg);
    doc.font("Helvetica-Bold").fontSize(8).fillColor(pillTextColor);
    text(status, R - 90, curY + 4, { width: 90, align: "center", characterSpacing: 1 });

    doc.font("Helvetica").fontSize(8.5).fillColor(C.muted);
    text(
      `Issue Date: ${formatDate(details.governance?.generatedAt || details.governance?.disbursedAt)}`,
      L,
      curY + 4
    );

    curY += 28;

    // ── 3. Employee Info Card ───────────────────────────────────────
    doc.roundedRect(L, curY, W, 84, 8).fillAndStroke(C.softBg, C.border);

    const col1X = L + 14;
    const col2X = L + 140;
    const col3X = L + 280;
    const col4X = L + 395;

    const rowY1 = curY + 10;
    const rowY2 = curY + 34;
    const rowY3 = curY + 58;

    const infoCell = (label, val, x, y, maxW = 120) => {
      doc.font("Helvetica-Bold").fontSize(7).fillColor(C.muted);
      text(label.toUpperCase(), x, y);
      doc.font("Helvetica-Bold").fontSize(8.5).fillColor(C.ink);
      text(val || "—", x, y + 10, { width: maxW, ellipsis: true });
    };

    infoCell("Employee Name", details.employee?.name, col1X, rowY1);
    infoCell("Employee Code", details.employee?.employeeCode, col2X, rowY1);
    infoCell("Designation", details.employee?.designation, col3X, rowY1);
    infoCell("Department", details.employee?.department, col4X, rowY1);

    infoCell("Branch / Location", details.employee?.branch, col1X, rowY2);
    infoCell("Date of Joining", formatDate(details.employee?.dateOfJoining), col2X, rowY2);
    infoCell("PAN Number", details.employee?.panNumber, col3X, rowY2);
    infoCell("UAN / PF No", details.employee?.uanNumber, col4X, rowY2);

    infoCell("Bank Name", details.employee?.bankName, col1X, rowY3);
    infoCell("Bank Account No", details.employee?.accountNumber, col2X, rowY3);
    infoCell("IFSC Code", details.employee?.ifscCode, col3X, rowY3);
    infoCell("Working Days", `${details.attendance?.workingDays || 0} Days`, col4X, rowY3);

    curY += 94;

    // ── 4. Attendance & Leaves Performance Strip ─────────────────────
    const attH = 34;
    doc.roundedRect(L, curY, W, attH, 6).fillAndStroke("#ffffff", C.border);

    const attCols = 7;
    const attColW = W / attCols;
    const attItems = [
      { label: "Working Days", val: details.attendance?.workingDays ?? 0, color: C.ink },
      { label: "Present Days", val: details.attendance?.presentDays ?? 0, color: C.success },
      { label: "Paid Leaves", val: details.attendance?.paidLeaveDays ?? 0, color: C.primary },
      { label: "Loss of Pay (LOP)", val: details.attendance?.unpaidLeaveDays ?? 0, color: C.danger },
      { label: "Late Marks", val: details.attendance?.lateCount ?? 0, color: "#ea580c" },
      { label: "Permission Hrs", val: `${details.attendance?.permissionHours ?? 0}h`, color: C.body },
      { label: "Overtime Hrs", val: `${details.attendance?.overtimeHours ?? 0}h`, color: C.primary },
    ];

    attItems.forEach((item, idx) => {
      const bx = L + idx * attColW;
      doc.font("Helvetica").fontSize(7).fillColor(C.muted);
      text(item.label, bx, curY + 6, { width: attColW, align: "center" });
      doc.font("Helvetica-Bold").fontSize(9.5).fillColor(item.color);
      text(String(item.val), bx, curY + 18, { width: attColW, align: "center" });

      if (idx < attCols - 1) {
        doc.moveTo(bx + attColW, curY + 5).lineTo(bx + attColW, curY + attH - 5).strokeColor(C.border).stroke();
      }
    });

    curY += attH + 12;

    // ── 5. Side-by-Side: Earnings vs Deductions ──────────────────────
    const colGap = 12;
    const tableW = (W - colGap) / 2;
    const earningsX = L;
    const deductionsX = L + tableW + colGap;

    const earningsList = details.earnings || [];
    const deductionsList = details.deductions || [];
    const maxRows = Math.max(earningsList.length, deductionsList.length, 6);
    const rowH = 19;
    const tableH = 26 + maxRows * rowH + 26; // Header + Rows + Total Bar

    // Left Box: Earnings
    doc.roundedRect(earningsX, curY, tableW, tableH, 6).strokeColor(C.border).stroke();
    doc.roundedRect(earningsX, curY, tableW, 24, 6).fill(C.softBg);
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor(C.primary);
    text("EARNINGS & ALLOWANCES", earningsX + 10, curY + 7);
    text("AMOUNT", earningsX, curY + 7, { width: tableW - 10, align: "right" });

    // Right Box: Deductions
    doc.roundedRect(deductionsX, curY, tableW, tableH, 6).strokeColor(C.border).stroke();
    doc.roundedRect(deductionsX, curY, tableW, 24, 6).fill(C.softBg);
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor(C.danger);
    text("DEDUCTIONS & RECOVERIES", deductionsX + 10, curY + 7);
    text("AMOUNT", deductionsX, curY + 7, { width: tableW - 10, align: "right" });

    // Render Rows
    let rowY = curY + 28;
    for (let i = 0; i < maxRows; i++) {
      const earn = earningsList[i];
      const ded = deductionsList[i];

      // Alternating row background
      if (i % 2 === 1) {
        doc.rect(earningsX + 1, rowY - 2, tableW - 2, rowH).fill("#fcfcfd");
        doc.rect(deductionsX + 1, rowY - 2, tableW - 2, rowH).fill("#fcfcfd");
      }

      if (earn) {
        doc.font("Helvetica").fontSize(8).fillColor(C.ink);
        text(earn.label, earningsX + 10, rowY, { width: tableW - 90, ellipsis: true });
        doc.font("Helvetica-Bold").fontSize(8).fillColor(C.ink);
        text(formatInr(earn.amount), earningsX, rowY, { width: tableW - 10, align: "right" });
      }

      if (ded) {
        doc.font("Helvetica").fontSize(8).fillColor(C.ink);
        text(ded.label, deductionsX + 10, rowY, { width: tableW - 90, ellipsis: true });
        doc.font("Helvetica-Bold").fontSize(8).fillColor(C.danger);
        text(formatInr(ded.amount), deductionsX, rowY, { width: tableW - 10, align: "right" });
      }

      rowY += rowH;
    }

    // Subtotal Footers
    const subtotalY = curY + tableH - 24;
    doc.rect(earningsX, subtotalY, tableW, 24).fill(C.softBg);
    doc.rect(deductionsX, subtotalY, tableW, 24).fill(C.softBg);
    doc.moveTo(earningsX, subtotalY).lineTo(earningsX + tableW, subtotalY).strokeColor(C.border).stroke();
    doc.moveTo(deductionsX, subtotalY).lineTo(deductionsX + tableW, subtotalY).strokeColor(C.border).stroke();

    const gross = details.totals?.grossSalary ?? 0;
    const totDeductions = details.totals?.totalDeductions ?? 0;

    doc.font("Helvetica-Bold").fontSize(8.5).fillColor(C.ink);
    text("GROSS EARNINGS", earningsX + 10, subtotalY + 7);
    doc.font("Helvetica-Bold").fontSize(9).fillColor(C.primary);
    text(formatInr(gross), earningsX, subtotalY + 7, { width: tableW - 10, align: "right" });

    doc.font("Helvetica-Bold").fontSize(8.5).fillColor(C.ink);
    text("TOTAL DEDUCTIONS", deductionsX + 10, subtotalY + 7);
    doc.font("Helvetica-Bold").fontSize(9).fillColor(C.danger);
    text(formatInr(totDeductions), deductionsX, subtotalY + 7, { width: tableW - 10, align: "right" });

    curY += tableH + 12;

    // ── 6. Net Take-Home Pay Banner ──────────────────────────────────
    const netH = 50;
    doc.roundedRect(L, curY, W, netH, 8).fill(C.primary);

    doc.font("Helvetica-Bold").fontSize(8).fillColor("#c7d2fe");
    text("NET TAKE-HOME SALARY DISBURSED", L + 16, curY + 10, { characterSpacing: 1 });

    const netSalary = details.totals?.netSalary ?? 0;
    doc.font("Helvetica-Bold").fontSize(18).fillColor("#ffffff");
    text(formatInr(netSalary), L + 16, curY + 22);

    // Net pay words & formula breakdown
    const words = details.totals?.netSalaryInWords || "";
    doc.font("Helvetica-Oblique").fontSize(8).fillColor("#e0e7ff");
    text(words, L + 180, curY + 14, { width: W - 195, ellipsis: true });

    doc.font("Helvetica").fontSize(7.5).fillColor("#c7d2fe");
    const reimbursements = Number(details.totals?.reimbursements || 0);
    const formulaStr = reimbursements > 0
      ? `Math: Gross (${formatInr(gross)}) - Deductions (${formatInr(totDeductions)}) + Reimbursements (${formatInr(reimbursements)}) = ${formatInr(netSalary)}`
      : `Math: Gross (${formatInr(gross)}) - Total Deductions (${formatInr(totDeductions)}) = ${formatInr(netSalary)}`;
    text(formulaStr, L + 180, curY + 30, { width: W - 195, ellipsis: true });

    curY += netH + 14;

    // ── 7. Detailed Deduction Explanation Box (Employee-friendly clarity) ────────
    const explH = 46;
    doc.roundedRect(L, curY, W, explH, 6).fillAndStroke(C.softBg, C.border);

    doc.font("Helvetica-Bold").fontSize(7.5).fillColor(C.ink);
    text("SALARY CALCULATION & DEDUCTIONS EXPLANATION:", L + 10, curY + 7);

    const dailyRate = details.rates?.dailyRate || (details.attendance?.workingDays > 0 ? Math.round(details.totals?.baseSalary / details.attendance.workingDays) : 0);
    const hourlyRate = details.rates?.hourlyRate || Math.round(dailyRate / 8);

    doc.font("Helvetica").fontSize(7).fillColor(C.body);
    const explLine1 = `• Base Daily Rate: ${formatInr(dailyRate)}/day (Base Salary / Working Days) | Hourly Rate: ${formatInr(hourlyRate)}/hr (Daily Rate / 8 hrs).`;
    text(explLine1, L + 10, curY + 19, { width: W - 20, ellipsis: true });

    const lopDays = details.attendance?.unpaidLeaveDays || 0;
    const lopDed = details.attendance?.unpaidLeaveDeduction || 0;
    const permDed = details.attendance?.permissionDeduction || 0;
    const lateDed = details.attendance?.lateDeduction || 0;

    const explLine2 = `• Leave Deduction (Loss of Pay): ${lopDays} unpaid days = ${formatInr(lopDed)}. Hour/Permission Deduction: ${formatInr(permDed)}. Late Marks: ${formatInr(lateDed)}.`;
    text(explLine2, L + 10, curY + 31, { width: W - 20, ellipsis: true });

    curY += explH + 16;

    // ── 8. Signatory & Compliance Footer ─────────────────────────────
    const declaration =
      details.template?.declarationText ||
      "This is an electronically generated and digitally authenticated payslip issued by WorkPluse HRMS. No physical signature is required.";

    doc.font("Helvetica").fontSize(7).fillColor(C.muted);
    text("COMPLIANCE & AUTHENTICITY NOTICE:", L, curY);
    text(declaration, L, curY + 10, { width: 340, lineBreak: true });

    const sigX = R - 140;
    const sigTitle = details.template?.signatoryTitle || "Head of Human Resources & Finance";
    const sigName = details.template?.signatoryName || "Authorized Signatory";

    doc.moveTo(sigX, curY + 34).lineTo(R, curY + 34).strokeColor(C.muted).stroke();
    doc.font("Helvetica-Bold").fontSize(8).fillColor(C.ink);
    text(sigName, sigX, curY + 38, { width: 140, align: "center" });
    doc.font("Helvetica").fontSize(7).fillColor(C.muted);
    text(sigTitle, sigX, curY + 48, { width: 140, align: "center" });

    doc.end();
  });
}

module.exports = { generatePayslipPdf };
