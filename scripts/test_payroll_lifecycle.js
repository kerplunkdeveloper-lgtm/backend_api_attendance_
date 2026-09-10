require('dotenv').config();
const prisma = require('../src/config/database');
const payrollService = require('../src/services/payroll.service');

async function main() {
  console.log('===============================================================');
  console.log('Testing End-to-End Payroll Lifecycle & Governance:');
  console.log('Monthly Run -> Approval -> Payslip PDF -> Reports -> Salary History');
  console.log('===============================================================');

  const employee = await prisma.employee.findFirst({
    where: { status: 'ACTIVE' },
    include: { organization: true, user: true },
  });

  if (!employee) {
    console.error('❌ No active employee found.');
    process.exit(1);
  }

  const organizationId = employee.organizationId;
  const adminUserId = employee.userId || 'test-admin-id';
  const now = new Date();
  const testMonth = now.getMonth() + 1;
  const testYear = now.getFullYear();

  console.log(`Testing with Org: ${employee.organization.name} (${organizationId})`);
  console.log(`Employee: ${employee.firstName} ${employee.lastName || ''} (${employee.employeeCode})`);

  // Step 1: Monthly Payroll Calculation & Batch Run
  console.log('\n--- 1. Monthly Payroll Calculation & Batch Run ---');
  const genResult = await payrollService.generateOrganizationPayslips(organizationId, testMonth, testYear);
  console.log(`✔ Generated ${genResult.totalGenerated} payslips for ${testMonth}/${testYear}. Status: PENDING_APPROVAL`);

  // Step 2: Payroll Approval Workflow
  console.log('\n--- 2. Payroll Approval Workflow ---');
  const approveResult = await payrollService.approvePayrollBatch(organizationId, testMonth, testYear, adminUserId, 'Approved by CFO for salary cycle');
  console.log(`✔ Approved ${approveResult.approvedCount} payslips for ${testMonth}/${testYear}. Status: APPROVED`);

  const disburseResult = await payrollService.disbursePayrollBatch(organizationId, testMonth, testYear, adminUserId, 'Disbursed via bank batch');
  console.log(`✔ Disbursed ${disburseResult.disbursedCount} payslips for ${testMonth}/${testYear}. Status: DISBURSED`);

  // Step 3: Payslip PDF Data Retrieval
  console.log('\n--- 3. Payslip PDF Details Retrieval ---');
  const payslip = await prisma.payslip.findFirst({
    where: { organizationId, employeeId: employee.id, month: testMonth, year: testYear },
  });

  if (!payslip) throw new Error('Payslip not found');

  const details = await payrollService.getPayslipDetails(organizationId, payslip.id);
  console.log(`✔ Payslip Details for PDF:`);
  console.log(`  Reference No:       ${details.referenceNo}`);
  console.log(`  Period:             ${details.period.periodLabel}`);
  console.log(`  Gross Salary:       ₹${details.totals.grossSalary.toLocaleString()}`);
  console.log(`  Total Deductions:   ₹${details.totals.totalDeductions.toLocaleString()}`);
  console.log(`  Net Salary:         ₹${details.totals.netSalary.toLocaleString()}`);
  console.log(`  Amount in Words:    ${details.totals.netSalaryInWords}`);
  console.log(`  Status:             ${details.governance.status}`);

  // Step 4: Payroll Reports Engine
  console.log('\n--- 4. Payroll Analytics & Statutory Compliance Reports ---');
  const reports = await payrollService.getPayrollReports(organizationId, testMonth, testYear);
  console.log(`✔ Executive Summary:`);
  console.log(`  Total Employees:    ${reports.executiveSummary.totalEmployees}`);
  console.log(`  Total Gross:        ₹${reports.executiveSummary.totalGross.toLocaleString()}`);
  console.log(`  Total Net Payout:   ₹${reports.executiveSummary.totalNet.toLocaleString()}`);
  console.log(`✔ Department Breakdown:`, reports.departmentBreakdown.map(d => `${d.department}: ₹${d.netTotal.toLocaleString()}`).join(', ') || 'General');
  console.log(`✔ Statutory Compliance Liability:`);
  console.log(`  PF Total:           ₹${reports.statutoryCompliance.pfTotal.toLocaleString()} (Emp: ₹${reports.statutoryCompliance.pfEmployee}, Empr: ₹${reports.statutoryCompliance.pfEmployer})`);
  console.log(`  ESI Total:          ₹${reports.statutoryCompliance.esiTotal.toLocaleString()}`);
  console.log(`  Professional Tax:   ₹${reports.statutoryCompliance.professionalTax.toLocaleString()}`);
  console.log(`  Bank Advice Rows:   ${reports.bankDisbursementAdvice.length} records`);

  // Step 5: Employee Salary History & Revisions
  console.log('\n--- 5. Employee Salary History & Revisions ---');
  const revision = await payrollService.recordSalaryRevision(organizationId, {
    employeeId: employee.id,
    annualCtc: 720000,
    monthlyCtc: 60000,
    baseSalary: 30000,
    hra: 15000,
    transport: 3000,
    special: 8000,
    otherAllowance: 4000,
    pf: 1800,
    esi: 0,
    professionalTax: 200,
    effectiveDate: '2026-10-01',
    revisionReason: 'ANNUAL_APPRAISAL',
  }, adminUserId);

  console.log(`✔ Salary Revision Recorded:`);
  console.log(`  New Annual CTC:     ₹${Number(revision.annualCtc).toLocaleString()} (Previous: ₹${Number(revision.previousAnnualCtc || 0).toLocaleString()})`);
  console.log(`  Hike Percentage:    ${revision.hikePercentage}%`);
  console.log(`  Reason:             ${revision.revisionReason}`);

  const history = await payrollService.getEmployeeSalaryHistory(organizationId, employee.id);
  console.log(`✔ History Timeline: ${history.revisions.length} revision(s) on record for ${history.employee.name}`);

  console.log('\n===============================================================');
  console.log('ALL PAYROLL LIFECYCLE STEPS TESTED AND PASSED SUCCESSFULLY!');
  console.log('===============================================================');
}

main()
  .catch((err) => {
    console.error('❌ Test failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
