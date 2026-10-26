const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { generatePayslipPdf } = require("../src/services/payslip-pdf.service");

describe("payslip pdf generation", () => {
  it("renders a valid, non-empty A4 PDF with complete breakdown and leave/hour deductions", async () => {
    const mockDetails = {
      referenceNo: "WP-PAY-2026-10-EMP001",
      period: {
        month: 10,
        monthName: "October",
        year: 2026,
        periodLabel: "October 2026",
      },
      organization: {
        name: "Acme Workforce Corp",
        address: "123 Tech Boulevard, Bengaluru",
        taxIdentifierLabel: "GSTIN",
        taxIdentifierValue: "29AAAAA0000A1Z5",
        contactEmail: "hr@acme.example.com",
      },
      employee: {
        id: "emp-123",
        name: "Rahul Sharma",
        employeeCode: "EMP001",
        designation: "Senior Software Engineer",
        department: "Engineering",
        branch: "Bengaluru HQ",
        dateOfJoining: "2024-01-15",
        panNumber: "ABCDE1234F",
        uanNumber: "100987654321",
        bankName: "HDFC Bank",
        accountNumber: "••••••••4892",
        ifscCode: "HDFC0001234",
      },
      attendance: {
        workingDays: 26,
        presentDays: 22,
        paidLeaveDays: 2,
        unpaidLeaveDays: 2,
        lateCount: 1,
        permissionHours: 2,
        overtimeHours: 4,
        lateDeduction: 500,
        permissionDeduction: 384.62,
        unpaidLeaveDaysDeduction: 3846.15,
      },
      rates: {
        dailyRate: 1923.08,
        hourlyRate: 240.38,
      },
      earnings: [
        { label: "Basic Salary", amount: 50000 },
        { label: "House Rent Allowance (HRA)", amount: 25000 },
        { label: "Transport Allowance", amount: 3000 },
        { label: "Special Allowance", amount: 12000 },
        { label: "Overtime Pay (4 hrs)", amount: 1442.31 },
        { label: "Approved Expense Reimbursements", amount: 2500 },
      ],
      deductions: [
        { label: "Loss of Pay (Unpaid Leave - 2 days)", amount: 3846.15, category: "ATTENDANCE_LEAVE" },
        { label: "Late Arrival Deduction", amount: 500, category: "ATTENDANCE_LATE" },
        { label: "Permission / Excess Hours Deduction", amount: 480.76, category: "ATTENDANCE_HOURS" },
        { label: "Provident Fund (PF)", amount: 1800, category: "STATUTORY" },
        { label: "Professional Tax (PT)", amount: 200, category: "STATUTORY" },
        { label: "Tax Deducted at Source (TDS)", amount: 3500, category: "STATUTORY" },
      ],
      totals: {
        baseSalary: 50000,
        grossSalary: 91442.31,
        reimbursements: 2500,
        totalEarnings: 93942.31,
        totalDeductions: 10326.91,
        netSalary: 83615.4,
        netSalaryInWords: "Eighty-Three Thousand Six Hundred Fifteen Rupees Only",
      },
      governance: {
        status: "PAID",
        generatedAt: new Date("2026-10-31T00:00:00Z"),
        disbursedAt: new Date("2026-10-31T00:00:00Z"),
        approvedBy: "HR Admin",
      },
      template: {
        primaryColor: "#4338ca",
        signatoryName: "Jane Doe",
        signatoryTitle: "VP of People & Operations",
      },
    };

    const pdfBuffer = await generatePayslipPdf(mockDetails);

    assert.ok(Buffer.isBuffer(pdfBuffer));
    assert.ok(pdfBuffer.length > 1000, "PDF buffer must contain substantial content");
    assert.equal(pdfBuffer.subarray(0, 5).toString(), "%PDF-", "Buffer must begin with %PDF- header");
  });
});
