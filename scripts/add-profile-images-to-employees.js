require("dotenv").config();
const prisma = require("../src/config/database");
const { resolveAvatarUrl } = require("../src/utils/avatar");

async function updateAllEmployeesAvatars() {
  console.log("=== Backfilling Profile Images to All Existing Employees ===");

  const employees = await prisma.employee.findMany({
    include: { user: true },
  });

  console.log(`Found ${employees.length} employees in the database.`);

  let updatedCount = 0;
  for (const emp of employees) {
    // Generate avatar based on name / code
    const avatarUrl = resolveAvatarUrl({
      avatarUrl: emp.avatarUrl,
      firstName: emp.firstName,
      lastName: emp.lastName,
      employeeCode: emp.employeeCode,
    });

    await prisma.employee.update({
      where: { id: emp.id },
      data: { avatarUrl },
    });

    if (emp.userId) {
      await prisma.user.update({
        where: { id: emp.userId },
        data: { avatarUrl },
      });
    }

    console.log(`✓ Updated: ${emp.firstName} ${emp.lastName || ""} (${emp.employeeCode}) -> ${avatarUrl}`);
    updatedCount++;
  }

  console.log(`\nSuccessfully updated profile images for all ${updatedCount} employees!`);
}

updateAllEmployeesAvatars()
  .catch((err) => {
    console.error("Error backfilling profile images:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
