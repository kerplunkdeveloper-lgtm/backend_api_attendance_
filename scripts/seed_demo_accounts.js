require("dotenv").config();
const bcrypt = require('bcryptjs');
const prisma = require('../src/config/database');

async function seedDemoAccounts() {
  console.log('--- Seeding Local Demo Accounts ---');

  // Find or create primary organization: Acme Global Corp
  let org = await prisma.organization.findFirst({
    where: {
      OR: [
        { name: 'Acme Global Corp' },
        { name: 'WorkPulse Technologies' },
        { name: 'WorkPulse Global Technologies' },
        { id: '58789d2a-4d54-484b-97bc-5aba4d6d03e9' }
      ]
    },
    include: { branches: true, departments: true, shifts: true }
  });

  if (!org) {
    org = await prisma.organization.create({
      data: {
        name: 'WorkPulse Global Technologies',
        email: 'contact@workpulse.com',
        phone: '+91 98765 43210'
      },
      include: { branches: true, departments: true, shifts: true }
    });
  }

  console.log(`Using Organization: ${org.name} (${org.id})`);

  // Ensure default branches exist
  let hqBranch = org.branches.find(b => b.name.includes('HQ') || b.name.includes('Pondy')) || org.branches[0];
  if (!hqBranch) {
    hqBranch = await prisma.branch.create({
      data: {
        organizationId: org.id,
        name: 'Pondicherry Technology HQ',
        address: '100 Beach Road, White Town, Pondicherry 605001',
        latitude: 11.9416,
        longitude: 79.8083,
        radiusMeters: 200
      }
    });
  }

  let chennaiBranch = org.branches.find(b => b.name.includes('chennai') || b.name.includes('Chennai'));
  if (!chennaiBranch) {
    chennaiBranch = await prisma.branch.create({
      data: {
        organizationId: org.id,
        name: 'Chennai Innovation Hub',
        address: 'OMR IT Corridor, Sholinganallur, Chennai 600119',
        latitude: 12.9010,
        longitude: 80.2279,
        radiusMeters: 300
      }
    });
  }

  // Ensure departments exist
  const deptNames = ['Engineering', 'Human Resources', 'Product & Design', 'Sales & Marketing'];
  const depts = {};
  for (const name of deptNames) {
    let dept = org.departments.find(d => d.name.toLowerCase() === name.toLowerCase());
    if (!dept) {
      dept = await prisma.department.create({
        data: { organizationId: org.id, name }
      });
    }
    depts[name] = dept;
  }

  // Ensure shift exists
  let shift = org.shifts[0];
  if (!shift) {
    shift = await prisma.shift.create({
      data: {
        organizationId: org.id,
        name: 'Standard General Shift',
        startTime: '09:00',
        endTime: '18:00',
        graceMinutes: 15,
        workingDays: '1,2,3,4,5,6'
      }
    });
  }

  // Password hash for demo users: Password@123
  const passwordHash = await bcrypt.hash('Password@123', 10);

  const demoUsers = [
    {
      email: 'admin@workpulse.com',
      role: 'COMPANY_ADMIN',
      firstName: 'Alex',
      lastName: 'Vance',
      phone: '+91 98765 00001',
      employeeCode: 'WP-ADM-001',
      branchId: hqBranch.id,
      departmentId: depts['Engineering']?.id,
      ctc: 1200000
    },
    {
      email: 'hr@workpulse.com',
      role: 'MANAGER',
      firstName: 'Sarah',
      lastName: 'Connor',
      phone: '+91 98765 00002',
      employeeCode: 'WP-HR-002',
      branchId: hqBranch.id,
      departmentId: depts['Human Resources']?.id,
      ctc: 900000
    },
    {
      email: 'manager@workpulse.com',
      role: 'MANAGER',
      firstName: 'Michael',
      lastName: 'Scott',
      phone: '+91 98765 00005',
      employeeCode: 'WP-MGR-002',
      branchId: hqBranch.id,
      departmentId: depts['Sales & Marketing']?.id || depts['Human Resources']?.id,
      ctc: 850000
    },
    {
      email: 'employee@workpulse.com',
      role: 'EMPLOYEE',
      firstName: 'David',
      lastName: 'Miller',
      phone: '+91 98765 00003',
      employeeCode: 'WP-EMP-003',
      branchId: hqBranch.id,
      departmentId: depts['Engineering']?.id,
      ctc: 600000
    },
    {
      email: 'priya@workpulse.com',
      role: 'EMPLOYEE',
      firstName: 'Priya',
      lastName: 'Sharma',
      phone: '+91 98765 00004',
      employeeCode: 'WP-EMP-004',
      branchId: chennaiBranch.id,
      departmentId: depts['Product & Design']?.id,
      ctc: 720000
    }
  ];

  for (const u of demoUsers) {
    // Upsert User
    const user = await prisma.user.upsert({
      where: {
        organizationId_email: {
          organizationId: org.id,
          email: u.email,
        },
      },
      update: {
        passwordHash,
        role: u.role,
        organizationId: org.id
      },
      create: {
        email: u.email,
        passwordHash,
        role: u.role,
        organizationId: org.id
      }
    });

    // Check Employee linked to this user
    let employee = await prisma.employee.findFirst({
      where: {
        OR: [
          { userId: user.id },
          { organizationId: org.id, employeeCode: u.employeeCode }
        ]
      }
    });

    if (employee) {
      employee = await prisma.employee.update({
        where: { id: employee.id },
        data: {
          userId: user.id,
          firstName: u.firstName,
          lastName: u.lastName,
          phone: u.phone,
          branchId: u.branchId,
          departmentId: u.departmentId,
          shiftId: shift.id,
          status: 'ACTIVE'
        }
      });
    } else {
      employee = await prisma.employee.create({
        data: {
          organizationId: org.id,
          userId: user.id,
          employeeCode: u.employeeCode,
          firstName: u.firstName,
          lastName: u.lastName,
          phone: u.phone,
          branchId: u.branchId,
          departmentId: u.departmentId,
          shiftId: shift.id,
          status: 'ACTIVE'
        }
      });
    }

    // Configure Salary Structure
    const monthlyCtc = Math.round(u.ctc / 12);
    const basic = Math.round(monthlyCtc * 0.50);
    const hra = Math.round(basic * 0.50);
    const transport = 3000;
    const special = Math.max(0, monthlyCtc - basic - hra - transport);
    const pf = Math.round(basic * 0.12);
    const pt = 200;

    await prisma.salaryStructure.upsert({
      where: { employeeId: employee.id },
      update: {
        annualCtc: u.ctc,
        monthlyCtc,
        baseSalary: basic,
        hra,
        transport,
        special,
        pf,
        professionalTax: pt,
        overtimeRate: 1.5
      },
      create: {
        organizationId: org.id,
        employeeId: employee.id,
        annualCtc: u.ctc,
        monthlyCtc,
        baseSalary: basic,
        hra,
        transport,
        special,
        pf,
        professionalTax: pt,
        overtimeRate: 1.5
      }
    });

    console.log(`✔ Seeded demo user: ${u.email} (${u.role}) -> ${u.firstName} ${u.lastName}`);
  }

  // Seed sample leave types if none exist
  const leaveTypes = await prisma.leaveType.findMany({ where: { organizationId: org.id } });
  if (leaveTypes.length === 0) {
    await prisma.leaveType.createMany({
      data: [
        { organizationId: org.id, name: 'Paid Leave', code: 'PL', daysAllowed: 18, isPaid: true },
        { organizationId: org.id, name: 'Sick Leave', code: 'SL', daysAllowed: 10, isPaid: true },
        { organizationId: org.id, name: 'Casual Leave', code: 'CL', daysAllowed: 12, isPaid: true }
      ]
    });
    console.log('✔ Seeded standard leave types (PL, SL, CL)');
  }

  console.log('--- Demo Accounts Seeding Complete! ---');
  console.log('Log in with:');
  console.log('  Admin:    admin@workpulse.com / Password@123');
  console.log('  HR:       hr@workpulse.com / Password@123');
  console.log('  Manager:  manager@workpulse.com / Password@123');
  console.log('  Employee: employee@workpulse.com / Password@123');
  console.log('  Priya:    priya@workpulse.com / Password@123');
}

seedDemoAccounts()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
