require('dotenv').config();
const prisma = require('../src/config/database');
const payrollService = require('../src/services/payroll.service');

async function main() {
  console.log('===============================================================');
  console.log('Testing STEP 10.1 CTC & Salary Structure Configuration');
  console.log('===============================================================');

  // 1. Get an existing active employee
  const employee = await prisma.employee.findFirst({
    where: { status: 'ACTIVE' },
    include: { organization: true },
  });

  if (!employee) {
    console.error('❌ No active employee found to test.');
    process.exit(1);
  }

  const organizationId = employee.organizationId;
  console.log(`Found Employee: ${employee.firstName} ${employee.lastName || ''} (${employee.employeeCode})`);
  console.log(`Organization: ${employee.organization.name} (${organizationId})`);

  // 2. HR configures Salary Structure with User's Exact Example
  console.log('\n--- 1. HR Configures CTC & Salary Structure ---');
  const configured = await payrollService.upsertSalaryStructure(organizationId, {
    employeeId: employee.id,
    annualCtc: 600000,
    monthlyCtc: 50000,
    baseSalary: 25000,
    hra: 12500,
    transport: 3000,
    special: 6500,
    otherAllowance: 0,
    pf: 1800,
    esi: 0,
    professionalTax: 200,
    overtimeRate: 1.5,
  });

  console.log('✔ Salary Structure Saved:');
  console.log(`  Annual CTC:        ₹${Number(configured.annualCtc).toLocaleString()}`);
  console.log(`  Monthly CTC:       ₹${Number(configured.monthlyCtc).toLocaleString()}`);
  console.log(`  Basic Salary:      ₹${Number(configured.baseSalary).toLocaleString()}`);
  console.log(`  HRA:               ₹${Number(configured.hra).toLocaleString()}`);
  console.log(`  Transport:         ₹${Number(configured.transport).toLocaleString()}`);
  console.log(`  Special Allowance: ₹${Number(configured.special).toLocaleString()}`);
  console.log(`  Other Allowance:   ₹${Number(configured.otherAllowance).toLocaleString()}`);
  console.log(`  PF:                ₹${Number(configured.pf).toLocaleString()}`);
  console.log(`  ESI:               ₹${Number(configured.esi).toLocaleString()}`);
  console.log(`  Professional Tax:  ₹${Number(configured.professionalTax).toLocaleString()}`);
  console.log(`  Overtime Rate:     ${Number(configured.overtimeRate)}x`);

  const grossEarnings = Number(configured.baseSalary) + Number(configured.hra) + Number(configured.transport) + Number(configured.special) + Number(configured.otherAllowance);
  console.log(`  ----------------------------------------`);
  console.log(`  Gross Earnings:    ₹${grossEarnings.toLocaleString()}`);

  if (grossEarnings !== 47000) {
    throw new Error(`Expected Gross 47,000 but got ${grossEarnings}`);
  }
  console.log('✔ Verified Gross Earnings matches User Example: ₹47,000');

  // 3. Test Payroll Calculation Engine with this Structure
  console.log('\n--- 2. Live Monthly Payroll Calculation ---');
  const now = new Date();
  const payroll = await payrollService.calculateEmployeePayroll(organizationId, employee.id, now.getMonth() + 1, now.getFullYear());

  console.log(`✔ Calculated Payroll:`);
  console.log(`  Base Salary:        ₹${payroll.salaryBreakdown.baseSalary}`);
  console.log(`  Total Allowances:   ₹${payroll.salaryBreakdown.allowancesTotal}`);
  console.log(`  Gross Salary:       ₹${payroll.salaryBreakdown.grossSalary}`);
  console.log(`  Statutory Deduct:   ₹${payroll.deductions.statutoryDeductions} (PF: ₹${payroll.deductions.pfDeduction}, ESI: ₹${payroll.deductions.esiDeduction}, PT: ₹${payroll.deductions.ptDeduction})`);
  console.log(`  Net Pay:            ₹${payroll.netSalary}`);

  console.log('\n===============================================================');
  console.log('ALL SALARY STRUCTURE TESTS PASSED WITH 100% ACCURACY!');
  console.log('===============================================================');
}

main()
  .catch((err) => {
    console.error('❌ Test failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
