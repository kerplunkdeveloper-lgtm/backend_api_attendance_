require("dotenv").config();
const bcrypt = require("bcryptjs");
const prisma = require("../src/config/database");

async function resetAndSeedFresh() {
  console.log("=====================================================");
  console.log("  WorkPulse™ — Complete Clean Database Reset & Seed  ");
  console.log("=====================================================\n");

  console.log("1. Clearing ALL existing tables in PostgreSQL...");
  const tables = [
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
    "Employee",
    "User",
    "Shift",
    "Department",
    "Branch",
    "Organization",
  ];

  for (const table of tables) {
    try {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE;`);
    } catch (err) {
      // If table doesn't exist or already empty, continue safely
    }
  }

  console.log("✔ All existing data and tables wiped clean.\n");

  console.log("2. Provisioning primary Organization...");
  const org = await prisma.organization.create({
    data: {
      id: "58789d2a-4d54-484b-97bc-5aba4d6d03e9",
      name: "WorkPulse Global Technologies",
      email: "contact@workpulse.com",
      phone: "+91 98765 43210",
    },
  });
  console.log(`✔ Created Organization: ${org.name} (${org.id})\n`);

  console.log("3. Provisioning Branches with Geofences...");
  const hqBranch = await prisma.branch.create({
    data: {
      organizationId: org.id,
      name: "Pondicherry Technology HQ",
      address: "100 Beach Road, White Town, Pondicherry 605001",
      latitude: 11.9344,
      longitude: 79.8358,
      radiusMeters: 250,
    },
  });

  const chennaiBranch = await prisma.branch.create({
    data: {
      organizationId: org.id,
      name: "Chennai Innovation Hub",
      address: "OMR IT Corridor, Sholinganallur, Chennai 600119",
      latitude: 12.901,
      longitude: 80.2279,
      radiusMeters: 300,
    },
  });

  const blrBranch = await prisma.branch.create({
    data: {
      organizationId: org.id,
      name: "Bangalore Tech Park",
      address: "Prestige Tech Cloud, Whitefield, Bangalore 560066",
      latitude: 12.9716,
      longitude: 77.5946,
      radiusMeters: 250,
    },
  });
  console.log(
    "✔ Provisioned 3 Branch Locations (Pondicherry HQ, Chennai, Bangalore)\n",
  );

  console.log("4. Provisioning Departments...");
  const depts = {};
  const deptList = [
    "Engineering",
    "Human Resources",
    "Product & Design",
    "Finance & Operations",
    "Sales & Marketing",
  ];

  for (const name of deptList) {
    depts[name] = await prisma.department.create({
      data: { organizationId: org.id, name },
    });
  }
  console.log(`✔ Provisioned ${deptList.length} operational departments\n`);

  console.log("5. Provisioning Shift Schedules...");
  const morningShift = await prisma.shift.create({
    data: {
      organizationId: org.id,
      name: "General Morning Shift (09:00 - 18:00)",
      startTime: "09:00",
      endTime: "18:00",
      graceMinutes: 15,
      workingDays: "1,2,3,4,5,6",
    },
  });

  const flexShift = await prisma.shift.create({
    data: {
      organizationId: org.id,
      name: "Flexible Mid Shift (11:00 - 20:00)",
      startTime: "11:00",
      endTime: "20:00",
      graceMinutes: 15,
      workingDays: "1,2,3,4,5,6",
    },
  });
  console.log("✔ Provisioned shift schedules\n");

  console.log("6. Provisioning Leave Policy Types...");
  const pl = await prisma.leaveType.create({
    data: {
      organizationId: org.id,
      name: "Paid Annual Leave",
      code: "PL",
      daysAllowed: 18,
      isPaid: true,
    },
  });
  const sl = await prisma.leaveType.create({
    data: {
      organizationId: org.id,
      name: "Sick Leave",
      code: "SL",
      daysAllowed: 12,
      isPaid: true,
    },
  });
  const cl = await prisma.leaveType.create({
    data: {
      organizationId: org.id,
      name: "Casual Leave",
      code: "CL",
      daysAllowed: 12,
      isPaid: true,
    },
  });
  console.log("✔ Provisioned standard leave types (PL, SL, CL)\n");

  console.log("7. Provisioning Official 2026 Holidays...");
  const holidays = [
    { name: "New Year Day", date: new Date("2026-01-01"), type: "COMPANY" },
    {
      name: "Pongal / Makar Sankranti",
      date: new Date("2026-01-15"),
      type: "GOVERNMENT",
    },
    { name: "Republic Day", date: new Date("2026-01-26"), type: "GOVERNMENT" },
    {
      name: "May Day (Labor Day)",
      date: new Date("2026-05-01"),
      type: "COMPANY",
    },
    {
      name: "Independence Day",
      date: new Date("2026-08-15"),
      type: "GOVERNMENT",
    },
    {
      name: "Gandhi Jayanti",
      date: new Date("2026-10-02"),
      type: "GOVERNMENT",
    },
    {
      name: "Diwali Festival",
      date: new Date("2026-11-08"),
      type: "GOVERNMENT",
    },
    { name: "Christmas Day", date: new Date("2026-12-25"), type: "GOVERNMENT" },
  ];

  for (const h of holidays) {
    await prisma.holiday.create({
      data: {
        organizationId: org.id,
        name: h.name,
        date: h.date,
        type: h.type,
      },
    });
  }
  console.log(`✔ Provisioned ${holidays.length} corporate holidays\n`);

  console.log("8. Provisioning Fresh Demo Users & Employees...");
  const passwordHash = await bcrypt.hash("Password@123", 10);

  const usersToCreate = [
    {
      email: "admin@workpulse.com",
      role: "COMPANY_ADMIN",
      firstName: "Alex",
      lastName: "Vance",
      phone: "+91 98765 00001",
      employeeCode: "WP-ADM-001",
      branchId: hqBranch.id,
      departmentId: depts["Engineering"].id,
      shiftId: morningShift.id,
      ctc: 1800000,
    },
    {
      email: "hr@workpulse.com",
      role: "MANAGER",
      firstName: "Sarah",
      lastName: "Connor",
      phone: "+91 98765 00002",
      employeeCode: "WP-HR-002",
      branchId: hqBranch.id,
      departmentId: depts["Human Resources"].id,
      shiftId: morningShift.id,
      ctc: 1200000,
    },
    {
      email: "manager@workpulse.com",
      role: "MANAGER",
      firstName: "Michael",
      lastName: "Scott",
      phone: "+91 98765 00003",
      employeeCode: "WP-MGR-003",
      branchId: hqBranch.id,
      departmentId: depts["Sales & Marketing"].id,
      shiftId: morningShift.id,
      ctc: 1100000,
    },
    {
      email: "employee@workpulse.com",
      role: "EMPLOYEE",
      firstName: "David",
      lastName: "Miller",
      phone: "+91 98765 00004",
      employeeCode: "WP-EMP-004",
      branchId: hqBranch.id,
      departmentId: depts["Engineering"].id,
      shiftId: morningShift.id,
      ctc: 750000,
    },
    {
      email: "priya@workpulse.com",
      role: "EMPLOYEE",
      firstName: "Priya",
      lastName: "Sharma",
      phone: "+91 98765 00005",
      employeeCode: "WP-EMP-005",
      branchId: chennaiBranch.id,
      departmentId: depts["Product & Design"].id,
      shiftId: flexShift.id,
      ctc: 850000,
    },
    {
      email: "finance@workpulse.com",
      role: "MANAGER",
      firstName: "Rohan",
      lastName: "Mehta",
      phone: "+91 98765 00006",
      employeeCode: "WP-FIN-006",
      branchId: blrBranch.id,
      departmentId: depts["Finance & Operations"].id,
      shiftId: morningShift.id,
      ctc: 1300000,
    },
  ];

  const createdEmployees = [];

  for (const u of usersToCreate) {
    const user = await prisma.user.create({
      data: {
        organizationId: org.id,
        email: u.email,
        passwordHash,
        role: u.role,
      },
    });

    const emp = await prisma.employee.create({
      data: {
        organizationId: org.id,
        userId: user.id,
        employeeCode: u.employeeCode,
        firstName: u.firstName,
        lastName: u.lastName,
        phone: u.phone,
        branchId: u.branchId,
        departmentId: u.departmentId,
        shiftId: u.shiftId,
        status: "ACTIVE",
      },
    });

    createdEmployees.push(emp);

    // Salary Structure
    const monthlyCtc = Math.round(u.ctc / 12);
    const basic = Math.round(monthlyCtc * 0.5);
    const hra = Math.round(basic * 0.5);
    const transport = 3000;
    const special = Math.max(0, monthlyCtc - basic - hra - transport);
    const pf = Math.round(basic * 0.12);
    const pt = 200;

    await prisma.salaryStructure.create({
      data: {
        organizationId: org.id,
        employeeId: emp.id,
        annualCtc: u.ctc,
        monthlyCtc,
        baseSalary: basic,
        hra,
        transport,
        special,
        pf,
        professionalTax: pt,
        overtimeRate: 1.5,
      },
    });

    // Leave Balances for 2026
    await prisma.leaveBalance.createMany({
      data: [
        {
          organizationId: org.id,
          employeeId: emp.id,
          leaveTypeId: pl.id,
          year: 2026,
          allocatedDays: 18,
          usedDays: 2,
        },
        {
          organizationId: org.id,
          employeeId: emp.id,
          leaveTypeId: sl.id,
          year: 2026,
          allocatedDays: 12,
          usedDays: 1,
        },
        {
          organizationId: org.id,
          employeeId: emp.id,
          leaveTypeId: cl.id,
          year: 2026,
          allocatedDays: 12,
          usedDays: 0,
        },
      ],
    });

    console.log(
      `✔ Created User & Employee: ${u.email} (${u.role}) — ${u.firstName} ${u.lastName} [${u.employeeCode}]`,
    );
  }

  console.log(
    "\n9. Provisioning Sample Live Attendance Activity for Dashboard...",
  );
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = 0; i < createdEmployees.length; i++) {
    const emp = createdEmployees[i];
    const checkInTime = new Date(today);
    checkInTime.setHours(8, 50 + i * 4, 0); // 8:50 AM, 8:54 AM, etc.

    const checkOutTime = i % 2 === 0 ? new Date(today) : null;
    if (checkOutTime) {
      checkOutTime.setHours(18, 5, 0);
    }

    const att = await prisma.attendance.create({
      data: {
        organizationId: org.id,
        employeeId: emp.id,
        branchId: emp.branchId,
        shiftId: emp.shiftId,
        date: today,
        checkIn: checkInTime,
        checkOut: checkOutTime,
        status: i === 3 ? "LATE" : "PRESENT",
        workingMinutes: checkOutTime ? 555 : 360,
        lateMinutes: i === 3 ? 18 : 0,
        checkInLatitude: 11.9344,
        checkInLongitude: 79.8358,
      },
    });

    await prisma.attendanceEvent.create({
      data: {
        attendanceId: att.id,
        type: "CHECK_IN",
        timestamp: checkInTime,
        latitude: 11.9344,
        longitude: 79.8358,
      },
    });

    if (checkOutTime) {
      await prisma.attendanceEvent.create({
        data: {
          attendanceId: att.id,
          type: "CHECK_OUT",
          timestamp: checkOutTime,
          latitude: 11.9344,
          longitude: 79.8358,
        },
      });
    }
  }
  console.log("✔ Provisioned realistic active attendance punches for today\n");

  console.log("10. Provisioning Sample Expense Reimbursement Claim...");
  await prisma.expenseClaim.create({
    data: {
      organizationId: org.id,
      employeeId: createdEmployees[3].id, // David Miller
      category: "TRAVEL",
      amount: 1450,
      date: new Date(),
      title: "Airport Taxi for Client Tech Summit",
      description:
        "Travel from Chennai International Airport to OMR Tech Park for client meetings.",
      status: "PENDING",
    },
  });

  await prisma.expenseClaim.create({
    data: {
      organizationId: org.id,
      employeeId: createdEmployees[4].id, // Priya Sharma
      category: "LEARNING",
      amount: 2999,
      date: new Date(),
      title: "Figma Advanced Enterprise UX Certification",
      description: "Online certification course on SaaS design systems.",
      status: "APPROVED",
      reviewedBy: "Sarah Connor (HR)",
      reviewNote: "Approved under annual learning and development budget.",
      reviewedAt: new Date(),
    },
  });
  console.log("✔ Provisioned sample expense claims (1 Pending, 1 Approved)\n");

  console.log("11. Provisioning Sample Leave Request for HR/Manager Review...");
  await prisma.leaveRequest.create({
    data: {
      organizationId: org.id,
      employeeId: createdEmployees[3].id, // David Miller
      leaveTypeId: pl.id,
      startDate: new Date(Date.now() + 86400000 * 2), // 2 days later
      endDate: new Date(Date.now() + 86400000 * 3),
      totalDays: 2,
      reason: "Family wedding event in Madurai",
      status: "PENDING",
    },
  });
  console.log("✔ Provisioned sample pending leave request\n");

  console.log("=====================================================");
  console.log("  FRESH DATABASE SEEDING COMPLETED SUCCESSFULLY!    ");
  console.log("=====================================================\n");
  console.log("Default Login Credentials (All use Password: Password@123):");
  console.log("---------------------------------------------------------");
  console.log("1. COMPANY ADMIN:     admin@workpulse.com");
  console.log("2. HR MANAGER:        hr@workpulse.com");
  console.log("3. SALES MANAGER:     manager@workpulse.com");
  console.log("4. SOFTWARE ENGINEER: employee@workpulse.com");
  console.log("5. PRODUCT DESIGNER:  priya@workpulse.com");
  console.log("6. FINANCE LEAD:      finance@workpulse.com");
  console.log("---------------------------------------------------------");
  console.log("Password for ALL accounts: Password@123\n");
}

resetAndSeedFresh()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
