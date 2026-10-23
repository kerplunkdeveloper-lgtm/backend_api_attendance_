const PDFDocument = require("pdfkit");
const billingService = require("./billing.service");

const money = (value) => `INR ${Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const date = (value) => new Date(value || Date.now()).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

function renderInvoicePdf(invoice) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 54, info: { Title: invoice.invoiceNumber, Author: "WorkPluse" } });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const org = invoice.organization || {};
    doc.fontSize(24).fillColor("#1e3a8a").text("WorkPluse", { continued: true });
    doc.fontSize(10).fillColor("#64748b").text("  Workforce Systems");
    doc.moveDown(1.5);
    doc.fontSize(22).fillColor("#0f172a").text("INVOICE");
    doc.fontSize(10).fillColor("#475569").text(invoice.invoiceNumber);
    doc.moveDown(1);

    doc.fontSize(10).fillColor("#64748b").text("BILLED TO");
    doc.fontSize(12).fillColor("#0f172a").text(org.name || "WorkPluse customer");
    doc.fontSize(10).fillColor("#475569").text([org.email, org.phone, org.address, org.taxId ? `Tax ID: ${org.taxId}` : null].filter(Boolean).join("\n"));
    doc.moveDown(1);
    doc.fontSize(10).fillColor("#475569").text(`Issued: ${date(invoice.issuedAt)}`);
    if (invoice.razorpayPaymentId) doc.text(`Payment reference: ${invoice.razorpayPaymentId}`);
    doc.moveDown(1.5);

    const left = 54;
    const right = 541;
    doc.rect(left, doc.y, right - left, 24).fill("#eef2ff");
    const headerY = doc.y + 7;
    doc.fillColor("#3730a3").fontSize(9).text("DESCRIPTION", left + 10, headerY);
    doc.text("AMOUNT", right - 90, headerY, { width: 80, align: "right" });
    doc.y += 34;
    const rows = [
      [`${invoice.plan} plan (${String(invoice.billingCycle || "MONTHLY").toLowerCase()})`, invoice.baseAmountInr],
      ...(invoice.discountAmountInr ? [[`Discount${invoice.couponCode ? ` (${invoice.couponCode})` : ""}`, -invoice.discountAmountInr]] : []),
      ...(invoice.taxAmountInr ? [["Tax", invoice.taxAmountInr]] : []),
    ];
    doc.fontSize(10);
    for (const [label, value] of rows) {
      doc.fillColor("#334155").text(label, left + 10, doc.y);
      doc.text(money(value), right - 110, doc.y, { width: 100, align: "right" });
      doc.moveDown(1.2);
    }
    doc.moveTo(right - 210, doc.y).lineTo(right, doc.y).strokeColor("#cbd5e1").stroke();
    doc.moveDown(0.7);
    doc.fontSize(13).fillColor("#0f172a").font("Helvetica-Bold").text("TOTAL", right - 210, doc.y);
    doc.text(money(invoice.amountInr), right - 110, doc.y, { width: 100, align: "right" });
    doc.font("Helvetica");
    doc.moveDown(3);
    doc.fontSize(9).fillColor("#64748b").text("Thank you for choosing WorkPluse. This invoice confirms a paid subscription order.");
    doc.end();
  });
}

async function createInvoicePdf(organizationId, orderId) {
  const invoice = await billingService.getInvoiceData(organizationId, orderId);
  return { invoice, pdf: await renderInvoicePdf(invoice) };
}

module.exports = { createInvoicePdf, renderInvoicePdf };
