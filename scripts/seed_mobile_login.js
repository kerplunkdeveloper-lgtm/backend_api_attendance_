const bcrypt = require("bcryptjs");
const prisma = require("../src/config/database");

const EMAIL = "employee@workpulse.com";
const PASSWORD = "Password@123";
const CODE = "WP-MOB-001";

async function run() {
  const orgSelect = { id: true, name: true };
  const org =
    (await prisma.organization.findFirst({ where: { name: "Mercuryminds" }, select: orgSelect })) ||
    (await prisma.organization.findFirst({ orderBy: { createdAt: "asc" }, select: orgSelect }));
  if (!org) throw new Error("No organization found");

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const user = await prisma.user.upsert({
    where: { organizationId_email: { organizationId: org.id, email: EMAIL } },
    update: { passwordHash, role: "EMPLOYEE", isActive: true, mustChangePassword: false },
    create: {
      organizationId: org.id,
      email: EMAIL,
      passwordHash,
      role: "EMPLOYEE",
      isActive: true,
      mustChangePassword: false,
    },
  });

  const existing = await prisma.employee.findFirst({
    where: { OR: [{ userId: user.id }, { organizationId: org.id, employeeCode: CODE }] },
  });
  if (existing) {
    await prisma.employee.update({
      where: { id: existing.id },
      data: { userId: user.id, firstName: "Mobile", lastName: "Demo", status: "ACTIVE", deletedAt: null },
    });
  } else {
    await prisma.employee.create({
      data: {
        organizationId: org.id,
        userId: user.id,
        employeeCode: CODE,
        firstName: "Mobile",
        lastName: "Demo",
        status: "ACTIVE",
      },
    });
  }

  console.log(`OK ${EMAIL} / ${PASSWORD} (${org.name}) code ${CODE}`);
}

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
