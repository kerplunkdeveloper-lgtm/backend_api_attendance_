const PDFDocument = require("pdfkit");
const billingService = require("./billing.service");

const money = (value) => {
  const n = Number(value || 0);
  const formatted = Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${n < 0 ? "- " : ""}INR ${formatted}`;
};
const date = (value) => new Date(value || Date.now()).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

function renderInvoicePdf(invoice) {
  return new Promise((resolve, reject) => {
    const PAGE_W = 595.28;
    const M = 48; // page margin
    const L = M;
    const R = PAGE_W - M;
    const W = R - L;
    const C = { brand: "#4338ca", ink: "#0f172a", body: "#334155", muted: "#64748b", line: "#e2e8f0", soft: "#f8fafc", tint: "#eef2ff", green: "#047857", greenBg: "#d1fae5" };

    // Margin 0 keeps pdfkit from adding pages on its own: everything is placed by coordinates.
    const doc = new PDFDocument({ size: "A4", margin: 0, info: { Title: invoice.invoiceNumber, Author: "WorkPluse" } });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const text = (value, x, y, opts = {}) => doc.text(String(value), x, y, { lineBreak: false, ...opts });
    const org = invoice.organization || {};
    const cycle = String(invoice.billingCycle || "MONTHLY").toLowerCase();
    const planName = `${String(invoice.plan || "").charAt(0)}${String(invoice.plan || "").slice(1).toLowerCase()}`;
    const isFree = Number(invoice.amountInr) === 0;

    // ── Header band ────────────────────────────────────────────────────────
    doc.rect(0, 0, PAGE_W, 108).fill(C.brand);
    doc.font("Helvetica-Bold").fontSize(22).fillColor("#ffffff");
    text("WorkPluse", L, 34);
    doc.font("Helvetica").fontSize(9).fillColor("#c7d2fe");
    text("Workforce Systems", L, 62);
    doc.font("Helvetica-Bold").fontSize(20).fillColor("#ffffff");
    text("INVOICE", L, 32, { width: W, align: "right" });
    doc.font("Helvetica").fontSize(10).fillColor("#c7d2fe");
    text(invoice.invoiceNumber, L, 60, { width: W, align: "right" });

    // ── Paid pill ──────────────────────────────────────────────────────────
    doc.roundedRect(R - 64, 132, 64, 22, 11).fill(C.greenBg);
    doc.font("Helvetica-Bold").fontSize(9).fillColor(C.green);
    text("PAID", R - 64, 139, { width: 64, align: "center", characterSpacing: 1 });

    // ── Billed to / details ────────────────────────────────────────────────
    const colGap = 24;
    const colW = (W - colGap) / 2;
    let y = 132;
    doc.font("Helvetica-Bold").fontSize(8).fillColor(C.muted);
    text("BILLED TO", L, y, { characterSpacing: 1 });
    doc.font("Helvetica-Bold").fontSize(13).fillColor(C.ink);
    const orgName = org.name || "WorkPluse customer";
    const nameW = colW - 70; // leaves room for the PAID pill
    doc.text(orgName, L, y + 16, { width: nameW, lineBreak: true, height: 34, ellipsis: true });
    const nameH = Math.min(doc.heightOfString(orgName, { width: nameW }), 34);
    doc.font("Helvetica").fontSize(9.5).fillColor(C.body);
    const addressLines = [org.email, org.phone, org.address, org.taxId ? `Tax ID: ${org.taxId}` : null].filter(Boolean);
    let ay = y + 16 + nameH + 6;
    for (const line of addressLines) {
      const h = doc.heightOfString(line, { width: colW });
      doc.text(line, L, ay, { width: colW, lineBreak: true });
      ay += h + 3;
    }

    const dx = L + colW + colGap;
    const detailRows = [
      ["Issue date", date(invoice.issuedAt)],
      ["Plan", `${planName} (${cycle})`],
      ...(invoice.razorpayPaymentId ? [["Payment ref", invoice.razorpayPaymentId]] : []),
      ...(isFree ? [["Payment", "No charge (offer applied)"]] : []),
    ];
    let dy = y + 34;
    for (const [label, value] of detailRows) {
      doc.font("Helvetica").fontSize(9).fillColor(C.muted);
      text(label, dx, dy, { width: 80 });
      doc.font("Helvetica-Bold").fontSize(9).fillColor(C.ink);
      text(value, dx + 84, dy, { width: colW - 84, align: "right", ellipsis: true });
      dy += 18;
    }

    // ── Items table ────────────────────────────────────────────────────────
    let ty = Math.max(ay, dy) + 28;
    doc.rect(L, ty, W, 28).fill(C.tint);
    doc.font("Helvetica-Bold").fontSize(8).fillColor(C.brand);
    text("DESCRIPTION", L + 14, ty + 10, { characterSpacing: 1 });
    text("AMOUNT", R - 134, ty + 10, { width: 120, align: "right", characterSpacing: 1 });
    ty += 28;

    const rows = [
      { label: `${planName} plan`, sub: `Billed ${cycle}`, value: invoice.baseAmountInr },
    ];
    for (const row of rows) {
      const rowH = row.sub ? 46 : 34;
      doc.font("Helvetica-Bold").fontSize(10.5).fillColor(C.ink);
      text(row.label, L + 14, ty + 10, { width: W - 170, ellipsis: true });
      if (row.sub) {
        doc.font("Helvetica").fontSize(8.5).fillColor(C.muted);
        text(row.sub, L + 14, ty + 26, { width: W - 170, ellipsis: true });
      }
      doc.font("Helvetica").fontSize(10.5).fillColor(row.negative ? C.green : C.body);
      text(money(row.value), R - 134, ty + 10, { width: 120, align: "right" });
      ty += rowH;
      doc.moveTo(L, ty).lineTo(R, ty).lineWidth(0.7).strokeColor(C.line).stroke();
    }

    // ── Totals ─────────────────────────────────────────────────────────────
    const boxW = 240;
    const bx = R - boxW;
    let by = ty + 18;
    const subtotal = Number(invoice.baseAmountInr || 0);
    const summary = [
      ["Subtotal", money(subtotal)],
      ...(invoice.discountAmountInr ? [["Discount", money(-invoice.discountAmountInr), invoice.couponCode ? `Offer ${invoice.couponCode}` : "Offer applied"]] : []),
      ...(invoice.taxAmountInr ? [["Tax", money(invoice.taxAmountInr)]] : []),
    ];
    const edge = R - 14; // every amount in the document ends on this line
    for (const [label, value, note] of summary) {
      doc.font("Helvetica").fontSize(10).fillColor(C.muted);
      text(label, bx, by, { width: 80 });
      doc.fillColor(note ? C.green : C.body);
      text(value, bx + 80, by, { width: edge - (bx + 80), align: "right" });
      if (note) {
        doc.font("Helvetica").fontSize(8).fillColor(C.muted);
        text(note, bx, by + 13, { width: edge - bx, ellipsis: true });
        by += 14;
      }
      by += 20;
    }
    by += 6;
    doc.roundedRect(bx - 12, by, boxW + 12, 44, 8).fill(C.soft);
    doc.roundedRect(bx - 12, by, boxW + 12, 44, 8).lineWidth(0.7).strokeColor(C.line).stroke();
    doc.font("Helvetica-Bold").fontSize(10).fillColor(C.muted);
    text("AMOUNT PAID", bx, by + 17, { characterSpacing: 0.5 });
    doc.font("Helvetica-Bold").fontSize(15).fillColor(C.ink);
    text(money(invoice.amountInr), bx + 90, by + 14, { width: edge - (bx + 90), align: "right" });

    // ── Footer (pinned to the bottom of the page) ──────────────────────────
    const fy = 842 - 74;
    doc.moveTo(L, fy).lineTo(R, fy).lineWidth(0.7).strokeColor(C.line).stroke();
    doc.font("Helvetica-Bold").fontSize(9).fillColor(C.body);
    text("Thank you for choosing WorkPluse.", L, fy + 14);
    doc.font("Helvetica").fontSize(8.5).fillColor(C.muted);
    text("This is a computer-generated invoice for a subscription order and needs no signature.", L, fy + 28);
    text(invoice.invoiceNumber, L, fy + 14, { width: W, align: "right" });

    doc.end();
  });
}

async function createInvoicePdf(organizationId, orderId) {
  const invoice = await billingService.getInvoiceData(organizationId, orderId);
  return { invoice, pdf: await renderInvoicePdf(invoice) };
}

module.exports = { createInvoicePdf, renderInvoicePdf };
