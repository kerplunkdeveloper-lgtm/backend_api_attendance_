require("dotenv").config();
const bcrypt = require("bcryptjs");
const prisma = require("../src/config/database");

const EMAIL = "vasanth@kerplunkmedia.com";
const PASSWORD = "Password@123";

async function main() {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  let org = await prisma.organization.findFirst({
    where: {
      OR: [{ name: "Kerplunkmedia" }, { email: EMAIL }],
    },
    include: { branches: true, departments: true, shifts: true },
  });

  if (!org) {
    org = await prisma.organization.create({
      data: {
        name: "Kerplunkmedia",
        email: EMAIL,
        timezone: "Asia/Kolkata",
        currency: "INR",
        subscriptionPlan: "FREE_TRIAL",
        subscriptionStatus: "TRIALING",
        maxEmployees: 10,
        planLocked: false,
      },
      include: { branches: true, departments: true, shifts: true },
    });
  } else {
    org = await prisma.organization.update({
      where: { id: org.id },
      data: { planLocked: false },
      include: { branches: true, departments: true, shifts: true },
    });
  }

  let branch = org.branches[0];
  if (!branch) {
    branch = await prisma.branch.create({
      data: {
        organizationId: org.id,
        name: "Head Office",
        address: "Pondicherry",
        latitude: 11.9416,
        longitude: 79.8083,
        radiusMeters: 250,
      },
    });
  }

  let department = org.departments[0];
  if (!department) {
    department = await prisma.department.create({
      data: { organizationId: org.id, name: "Administration" },
    });
  }

  let shift = org.shifts[0];
  if (!shift) {
    shift = await prisma.shift.create({
      data: {
        organizationId: org.id,
        name: "General Shift",
        startTime: "09:00",
        endTime: "18:00",
        graceMinutes: 15,
        workingDays: "1,2,3,4,5",
      },
    });
  }

  const user = await prisma.user.upsert({
    where: {
      organizationId_email: {
        organizationId: org.id,
        email: EMAIL,
      },
    },
    update: {
      passwordHash,
      role: "COMPANY_ADMIN",
      isActive: true,
      mustChangePassword: false,
    },
    create: {
      organizationId: org.id,
      email: EMAIL,
      passwordHash,
      role: "COMPANY_ADMIN",
      isActive: true,
      mustChangePassword: false,
    },
  });

  const existingEmployee = await prisma.employee.findFirst({
    where: {
      OR: [
        { userId: user.id },
        { organizationId: org.id, employeeCode: "KM-ADM-001" },
      ],
    },
  });

  if (existingEmployee) {
    await prisma.employee.update({
      where: { id: existingEmployee.id },
      data: {
        userId: user.id,
        firstName: "Vasanth",
        lastName: "Raj",
        status: "ACTIVE",
        branchId: branch.id,
        departmentId: department.id,
        shiftId: shift.id,
        deletedAt: null,
      },
    });
  } else {
    await prisma.employee.create({
      data: {
        organizationId: org.id,
        userId: user.id,
        employeeCode: "KM-ADM-001",
        firstName: "Vasanth",
        lastName: "Raj",
        workEmail: EMAIL,
        status: "ACTIVE",
        branchId: branch.id,
        departmentId: department.id,
        shiftId: shift.id,
      },
    });
  }

  console.log("Ready:", EMAIL, "org:", org.name, "role:", user.role);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
