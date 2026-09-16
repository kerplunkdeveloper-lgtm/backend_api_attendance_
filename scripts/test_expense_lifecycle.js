const prisma = require('../src/config/database');
const expenseService = require('../src/services/expense.service');
const payrollService = require('../src/services/payroll.service');

async function runTest() {
  console.log('====================================================');
  console.log('E2E TEST: Expense Claims -> Cloudinary -> Approval -> Payroll Bundling');
  console.log('====================================================\n');

  const user = await prisma.user.findFirst({ where: { role: { in: ['COMPANY_ADMIN', 'MANAGER'] } } });
  const org = await prisma.organization.findUnique({ where: { id: user.organizationId } });
  const emp = await prisma.employee.findFirst({ where: { organizationId: org.id } });

  console.log('Test Organization:', org.name);
  console.log('Test Employee:', emp.firstName, emp.lastName, '[' + emp.employeeCode + ']');

  // Step 1: Submit Claim with Base64 receipt (auto-uploaded to Cloudinary)
  console.log('\nStep 1: Submitting expense claim with receipt...');
  const sampleBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const claim = await expenseService.createExpenseClaim(org.id, emp.id, {
    category: 'FUEL',
    amount: 1850.00,
    title: 'Fuel Reimbursement - Client Site Visit',
    description: 'Travel from Corporate HQ to Client manufacturing plant',
    receiptData: sampleBase64,
    date: new Date(),
  });

  console.log('✔ Claim Created:', claim.id);
  console.log('  Category:', claim.category);
  console.log('  Amount: ₹' + claim.amount);
  console.log('  Cloudinary Receipt URL:', claim.receiptUrl);

  if (!claim.receiptUrl.includes('cloudinary.com')) {
    throw new Error('Receipt was not uploaded to Cloudinary');
  }

  // Step 2: HR Review & Approval
  console.log('\nStep 2: HR reviews and approves the claim...');
  const reviewed = await expenseService.reviewExpenseClaim(org.id, claim.id, user.id, {
    status: 'APPROVED',
    reviewNote: 'Fuel claim verified against travel log. Approved for reimbursement.',
  });
  console.log('✔ Claim Status Updated:', reviewed.status);
  console.log('  Audit Review Note:', reviewed.reviewNote);

  // Step 3: Check Payroll calculation
  console.log('\nStep 3: Calculating employee payroll with bundled reimbursements...');
  const payroll = await payrollService.calculateEmployeePayroll(org.id, emp.id, 9, 2026);
  console.log('✔ Base Salary: ₹' + payroll.salaryBreakdown.baseSalary);
  console.log('✔ Gross Salary: ₹' + payroll.salaryBreakdown.grossSalary);
  console.log('✔ Approved Reimbursements: ₹' + payroll.reimbursements);
  console.log('✔ Final Net Salary (with Reimbursements): ₹' + payroll.netSalary);

  if (Number(payroll.reimbursements) < 1850) {
    throw new Error('Approved reimbursement was not added to payroll calculation');
  }

  // Step 4: Generate Payslip & confirm claim status transitions to PAID
  console.log('\nStep 4: Generating organization payslip and verifying claim status...');
  const genResult = await payrollService.generateOrganizationPayslips(org.id, 9, 2026);
  console.log('✔ Total Payslips Generated:', genResult.totalGenerated);

  const updatedClaim = await prisma.expenseClaim.findUnique({ where: { id: claim.id } });
  console.log('✔ Claim Lifecycle Status after Payroll Generation:', updatedClaim.status);
  console.log('✔ Linked Payslip ID:', updatedClaim.payslipId);

  if (updatedClaim.status !== 'PAID') {
    throw new Error('Expense claim was not marked as PAID upon payslip bundling');
  }

  // Cleanup test claim & payslip
  await prisma.expenseClaim.delete({ where: { id: claim.id } });
  await prisma.payslip.deleteMany({ where: { employeeId: emp.id, month: 9, year: 2026 } });
  console.log('\n✔ Test artifacts cleaned up successfully.');

  console.log('\n====================================================');
  console.log('ALL E2E VERIFICATION CHECKS PASSED 100%!');
  console.log('====================================================');
}

runTest()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n❌ Test failed:', err);
    process.exit(1);
  });
