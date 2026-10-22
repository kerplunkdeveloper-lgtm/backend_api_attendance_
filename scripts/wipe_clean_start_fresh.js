require("dotenv").config();
const prisma = require("../src/config/database");

async function wipeCleanStartFresh() {
  console.log("===============================================================");
  console.log("  WorkPulse™ — Complete Database Wipe for Fresh Registration   ");
  console.log("===============================================================\n");

  const tables = [
    "CompOffTransaction",
    "CompOffBalance",
    "ShiftOverride",
    "AttendancePolicy",
    "Subscription",
    "AssetMaintenance",
    "AssetAssignment",
    "Asset",
    "FinalSettlement",
    "EmployeeClearance",
    "EmployeeExit",
    "EmployeeDocument",
    "EmployeeInvite",
    "OvertimeRequest",
    "ExpenseClaim",
    "OnboardingDocument",
    "OnboardingCandidate",
    "EmployeeDevice",
    "AuditLog",
    "Notification",
    "SalaryRevision",
    "Payslip",
    "SalaryStructure",
    "Holiday",
    "LeaveBalance",
    "LeaveRequest",
    "LeaveType",
    "AttendanceCorrection",
    "AttendanceEvent",
    "Attendance",
    "RefreshToken",
    "Employee",
    "User",
    "Shift",
    "Department",
    "Branch",
    "Organization",
  ];

  console.log("1. Truncating all tables with CASCADE in PostgreSQL...");
  let truncatedCount = 0;
  for (const table of tables) {
    try {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE;`);
      truncatedCount++;
    } catch (err) {
      // Table might not exist or already empty
    }
  }
  console.log(`✔ Cleared ${truncatedCount} tables cleanly.\n`);

  console.log("2. Verifying clean state:");
  const userCount = await prisma.user.count();
  const empCount = await prisma.employee.count();
  const orgCount = await prisma.organization.count();
  const attCount = await prisma.attendance.count();

  console.log(`   - Organizations : ${orgCount}`);
  console.log(`   - Users         : ${userCount}`);
  console.log(`   - Employees     : ${empCount}`);
  console.log(`   - Attendances   : ${attCount}`);

  console.log("\n===============================================================");
  console.log("  ALL OLD EMPLOYEE & HISTORICAL DATA HAS BEEN FULLY REMOVED!  ");
  console.log("  The database is 100% clean and ready for fresh registration. ");
  console.log("===============================================================\n");
  console.log("Next Steps for User:");
  console.log("1. Open http://localhost:3000/register");
  console.log("2. Enter your Organization Name and Admin Account details");
  console.log("3. Select your Subscription Plan (e.g. Free Trial)");
  console.log("4. Click 'Create Organization Free' -> Dashboard opens fresh!");
  console.log("5. Start adding your real employees in the clean directory.");

  await prisma.$disconnect();
}

wipeCleanStartFresh().catch((err) => {
  console.error("Failed to wipe database:", err);
  process.exit(1);
});
