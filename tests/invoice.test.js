const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { renderInvoicePdf } = require("../src/services/invoice.service");

describe("billing invoices", () => {
  it("renders a non-empty PDF with the invoice identity", async () => {
    const pdf = await renderInvoicePdf({
      invoiceNumber: "INV-TEST1234",
      issuedAt: new Date("2026-10-12T00:00:00Z"),
      plan: "STARTER",
      billingCycle: "MONTHLY",
      amountInr: 1999.2,
      baseAmountInr: 2499,
      discountAmountInr: 499.8,
      taxAmountInr: 0,
      couponCode: "WELCOME20",
      razorpayPaymentId: "pay_test",
      organization: { name: "Example Workspace", email: "billing@example.com" },
    });

    assert.ok(Buffer.isBuffer(pdf));
    assert.ok(pdf.length > 500);
    assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  });
});
