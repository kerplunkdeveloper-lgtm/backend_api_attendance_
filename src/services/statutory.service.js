const prisma = require("../config/database");
const { currentFinancialYear, fyBounds, computeAnnualTax } = require("../utils/incomeTax");

function num(v) {
  return Number(v || 0);
}

function csvEscape(v) {
  const s = v == null ? "" : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(headers, rows) {
  return [headers.join(","), ...rows.map((r) => r.map(csvEscape).join(","))].join("\n");
}

async function resolveEmployee(organizationId, user) {
  if (user.employee?.id) return user.employee.id;
  const emp = await prisma.employee.findFirst({
    where: { organizationId, userId: user.id },
    select: { id: true },
  });
  return emp?.id || null;
}

async function getOrCreateDeclaration(organizationId, employeeId, financialYear) {
  const fy = financialYear || currentFinancialYear();
  return prisma.itDeclaration.upsert({
    where: { employeeId_financialYear: { employeeId, financialYear: fy } },
    update: {},
    create: { organizationId, employeeId, financialYear: fy, regime: "NEW" },
  });
}

async function upsertDeclaration(organizationId, employeeId, payload) {
  const fy = payload.financialYear || currentFinancialYear();
  const data = {
    regime: payload.regime === "OLD" ? "OLD" : "NEW",
    rentPaidAnnual: num(payload.rentPaidAnnual),
    isMetro: payload.isMetro !== false,
    section80C: num(payload.section80C),
    section80D: num(payload.section80D),
    homeLoanInterest: num(payload.homeLoanInterest),
    npsEmployee: num(payload.npsEmployee),
    otherExemptions: num(payload.otherExemptions),
    previousEmployerIncome: num(payload.previousEmployerIncome),
    previousEmployerTds: num(payload.previousEmployerTds),
    status: payload.submit ? "SUBMITTED" : payload.status || "DRAFT",
    submittedAt: payload.submit ? new Date() : undefined,
  };
  return prisma.itDeclaration.upsert({
    where: { employeeId_financialYear: { employeeId, financialYear: fy } },
    update: data,
    create: { organizationId, employeeId, financialYear: fy, ...data },
  });
}

async function estimateForEmployee(organizationId, employeeId, financialYear) {
  const fy = financialYear || currentFinancialYear();
  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, organizationId },
    include: { salaryStructure: true, organization: { select: { name: true } } },
  });
  if (!employee) {
    const err = new Error("Employee not found");
    err.statusCode = 404;
    throw err;
  }
  const declaration = await getOrCreateDeclaration(organizationId, employeeId, fy);
  const salary = employee.salaryStructure;
  const annualGross = salary
    ? num(salary.annualCtc) || num(salary.monthlyCtc) * 12 || num(salary.baseSalary) * 12
    : 0;
  const annualBasic = salary ? num(salary.baseSalary) * 12 : 0;
  const annualHra = salary ? num(salary.hra) * 12 : 0;
  const tax = computeAnnualTax({
    annualGross,
    annualBasic,
    annualHra,
    regime: declaration.regime,
    declaration,
  });

  const { start, end } = fyBounds(fy);
  const slips = await prisma.payslip.findMany({
    where: {
      organizationId,
      employeeId,
      OR: [
        { year: start.getUTCFullYear(), month: { gte: 4 } },
        { year: end.getUTCFullYear(), month: { lte: 3 } },
      ],
    },
    select: { tdsDeduction: true, grossSalary: true, month: true, year: true },
  });
  const tdsDeducted = slips.reduce((s, p) => s + num(p.tdsDeduction), 0);
  return {
    employee: {
      id: employee.id,
      name: `${employee.firstName} ${employee.lastName || ""}`.trim(),
      employeeCode: employee.employeeCode,
      panNumber: employee.panNumber,
      organizationName: employee.organization?.name,
    },
    financialYear: fy,
    declaration,
    tax: { ...tax, tdsDeducted, taxPayable: Math.round(tax.totalTax - tdsDeducted) },
  };
}

function form16Html(estimate) {
  const t = estimate.tax;
  const e = estimate.employee;
  const d = estimate.declaration;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Form 16 ${estimate.financialYear}</title>
<style>body{font-family:Inter,Arial,sans-serif;color:#0f172a;padding:32px;max-width:800px;margin:auto}
h1{font-size:20px;margin:0}table{width:100%;border-collapse:collapse;margin-top:16px}
td,th{border:1px solid #e2e8f0;padding:8px;text-align:left;font-size:13px}
.muted{color:#64748b;font-size:12px}</style></head><body>
<h1>Form 16 — Part B (WorkPulse)</h1>
<p class="muted">${e.organizationName || "Organization"} · FY ${estimate.financialYear} · ${t.financialYearNote} · ${t.regime} regime</p>
<table>
<tr><th>Employee</th><td>${e.name} (${e.employeeCode || ""})</td></tr>
<tr><th>PAN</th><td>${e.panNumber || "—"}</td></tr>
<tr><th>Gross salary</th><td>₹${t.annualGross.toLocaleString("en-IN")}</td></tr>
<tr><th>Standard deduction</th><td>₹${t.standardDeduction.toLocaleString("en-IN")}</td></tr>
<tr><th>Total exemptions / deductions</th><td>₹${t.exemptions.toLocaleString("en-IN")}</td></tr>
<tr><th>Taxable income</th><td>₹${t.taxableIncome.toLocaleString("en-IN")}</td></tr>
<tr><th>Tax on income</th><td>₹${t.taxOnIncome.toLocaleString("en-IN")}</td></tr>
<tr><th>Rebate u/s 87A</th><td>₹${t.rebate87A.toLocaleString("en-IN")}</td></tr>
<tr><th>Health & education cess 4%</th><td>₹${t.cess.toLocaleString("en-IN")}</td></tr>
<tr><th>Total tax</th><td>₹${t.totalTax.toLocaleString("en-IN")}</td></tr>
<tr><th>TDS deducted</th><td>₹${t.tdsDeducted.toLocaleString("en-IN")}</td></tr>
<tr><th>Tax payable / (refund)</th><td>₹${t.taxPayable.toLocaleString("en-IN")}</td></tr>
<tr><th>Declaration regime</th><td>${d.regime} · ${d.status}</td></tr>
</table>
<p class="muted">Computer-generated Form 16 summary for payroll records. File ITR on the Income Tax portal for the official certificate.</p>
</body></html>`;
}

async function generateForm16(organizationId, employeeId, financialYear) {
  const estimate = await estimateForEmployee(organizationId, employeeId, financialYear);
  const html = form16Html(estimate);
  const t = estimate.tax;
  const record = await prisma.form16Record.upsert({
    where: {
      employeeId_financialYear: { employeeId, financialYear: estimate.financialYear },
    },
    update: {
      regime: t.regime,
      grossSalary: t.annualGross,
      exemptions: t.exemptions,
      standardDeduction: t.standardDeduction,
      taxableIncome: t.taxableIncome,
      taxOnIncome: t.taxOnIncome,
      rebate87A: t.rebate87A,
      cess: t.cess,
      totalTax: t.totalTax,
      tdsDeducted: t.tdsDeducted,
      taxPayable: t.taxPayable,
      html,
    },
    create: {
      organizationId,
      employeeId,
      financialYear: estimate.financialYear,
      regime: t.regime,
      grossSalary: t.annualGross,
      exemptions: t.exemptions,
      standardDeduction: t.standardDeduction,
      taxableIncome: t.taxableIncome,
      taxOnIncome: t.taxOnIncome,
      rebate87A: t.rebate87A,
      cess: t.cess,
      totalTax: t.totalTax,
      tdsDeducted: t.tdsDeducted,
      taxPayable: t.taxPayable,
      html,
    },
  });
  return { record, estimate, html };
}

async function generateForm16Batch(organizationId, financialYear) {
  const fy = financialYear || currentFinancialYear();
  const employees = await prisma.employee.findMany({
    where: { organizationId, status: "ACTIVE" },
    select: { id: true },
  });
  const results = [];
  for (const e of employees) {
    try {
      results.push(await generateForm16(organizationId, e.id, fy));
    } catch (err) {
      results.push({ employeeId: e.id, error: err.message });
    }
  }
  return { financialYear: fy, count: results.length, results };
}

async function monthlyTdsForEmployee(organizationId, employeeId) {
  try {
    const estimate = await estimateForEmployee(organizationId, employeeId);
    return estimate.tax.monthlyTds || 0;
  } catch {
    return 0;
  }
}

async function listPayslipsForMonth(organizationId, month, year) {
  return prisma.payslip.findMany({
    where: { organizationId, month: Number(month), year: Number(year) },
    include: {
      employee: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          employeeCode: true,
          panNumber: true,
          uanNumber: true,
          esiNumber: true,
          bankName: true,
          bankAccountNumber: true,
          bankIfsc: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });
}

async function saveExport(organizationId, userId, type, month, year, fileName, content, mimeType, rowCount) {
  return prisma.statutoryExport.create({
    data: {
      organizationId,
      type,
      month: Number(month),
      year: Number(year),
      fileName,
      content,
      mimeType,
      rowCount,
      createdByUserId: userId || null,
    },
  });
}

async function exportPfEcr(organizationId, month, year, userId) {
  const slips = await listPayslipsForMonth(organizationId, month, year);
  const lines = slips.map((p) => {
    const e = p.employee;
    const name = `${e.firstName} ${e.lastName || ""}`.trim();
    const gross = num(p.grossSalary);
    const epfWage = Math.min(num(p.baseSalary), 15000);
    const eePf = num(p.pfDeduction);
    const erPf = eePf;
    const eps = Math.round(epfWage * 0.0833);
    return [
      e.uanNumber || "",
      name,
      gross,
      epfWage,
      epfWage,
      epfWage,
      eePf,
      eps,
      Math.round(epfWage * 0.005),
      0,
      0,
    ].join("#");
  });
  const content = lines.join("\n");
  const fileName = `PF_ECR_${year}_${String(month).padStart(2, "0")}.txt`;
  const saved = await saveExport(organizationId, userId, "PF_ECR", month, year, fileName, content, "text/plain", slips.length);
  return { fileName, content, mimeType: "text/plain", rowCount: slips.length, id: saved.id };
}

async function exportEsi(organizationId, month, year, userId) {
  const slips = await listPayslipsForMonth(organizationId, month, year);
  const headers = ["IP Number", "Name", "Employee Code", "Days", "Wages", "Employee ESI", "Employer ESI"];
  const rows = slips.map((p) => {
    const e = p.employee;
    const wages = num(p.grossSalary);
    return [
      e.esiNumber || "",
      `${e.firstName} ${e.lastName || ""}`.trim(),
      e.employeeCode,
      p.workingDays,
      wages,
      num(p.esiDeduction),
      Math.round(wages * 0.0325),
    ];
  });
  const content = toCsv(headers, rows);
  const fileName = `ESI_${year}_${String(month).padStart(2, "0")}.csv`;
  const saved = await saveExport(organizationId, userId, "ESI", month, year, fileName, content, "text/csv", rows.length);
  return { fileName, content, mimeType: "text/csv", rowCount: rows.length, id: saved.id };
}

async function exportNeft(organizationId, month, year, userId) {
  const slips = await listPayslipsForMonth(organizationId, month, year);
  const headers = ["Beneficiary Name", "Account Number", "IFSC", "Bank", "Amount", "Employee Code", "Particulars"];
  const rows = slips.map((p) => {
    const e = p.employee;
    return [
      `${e.firstName} ${e.lastName || ""}`.trim(),
      e.bankAccountNumber || "",
      e.bankIfsc || "",
      e.bankName || "",
      num(p.netSalary),
      e.employeeCode,
      `SALARY ${String(month).padStart(2, "0")}${year}`,
    ];
  });
  const content = toCsv(headers, rows);
  const fileName = `NEFT_NACH_${year}_${String(month).padStart(2, "0")}.csv`;
  const saved = await saveExport(organizationId, userId, "NEFT", month, year, fileName, content, "text/csv", rows.length);
  return { fileName, content, mimeType: "text/csv", rowCount: rows.length, id: saved.id };
}

async function listExports(organizationId) {
  return prisma.statutoryExport.findMany({
    where: { organizationId },
    select: {
      id: true,
      type: true,
      month: true,
      year: true,
      fileName: true,
      mimeType: true,
      rowCount: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

async function getExport(organizationId, id) {
  const file = await prisma.statutoryExport.findFirst({ where: { id, organizationId } });
  if (!file) {
    const err = new Error("Export not found");
    err.statusCode = 404;
    throw err;
  }
  return file;
}

module.exports = {
  currentFinancialYear,
  resolveEmployee,
  getOrCreateDeclaration,
  upsertDeclaration,
  estimateForEmployee,
  generateForm16,
  generateForm16Batch,
  monthlyTdsForEmployee,
  exportPfEcr,
  exportEsi,
  exportNeft,
  listExports,
  getExport,
};
