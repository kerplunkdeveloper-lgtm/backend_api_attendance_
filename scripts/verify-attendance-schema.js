const prisma = require("../src/config/database");

async function main() {
  // Prisma selects every scalar field here, so this catches schema drift such
  // as a missing checkInLocation/checkOutLocation column before deployment.
  await prisma.attendance.findFirst();
  console.log("Attendance schema query succeeded.");
}

main()
  .catch((error) => {
    console.error(`Attendance schema query failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
