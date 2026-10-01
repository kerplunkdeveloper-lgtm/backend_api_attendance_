require("dotenv").config();
const prisma = require("../src/config/database");

const APPLY = process.argv.includes("--apply");
const TARGET_ORGANIZATION_ID = process.env.SEED_ORGANIZATION_ID || null;
const SEED_PREFIX = "KMD";
const SEED_YEAR = new Date().getUTCFullYear();

const branches = [
  { name: "Puducherry Headquarters", address: "White Town, Puducherry 605001", latitude: 11.9341, longitude: 79.8306, radiusMeters: 300 },
  { name: "Chennai Technology Centre", address: "Taramani, Chennai 600113", latitude: 12.9866, longitude: 80.2457, radiusMeters: 350 },
  { name: "Bengaluru Digital Hub", address: "Indiranagar, Bengaluru 560038", latitude: 12.9784, longitude: 77.6408, radiusMeters: 350 },
  { name: "Hyderabad Delivery Centre", address: "HITEC City, Hyderabad 500081", latitude: 17.4435, longitude: 78.3772, radiusMeters: 350 },
];

const departments = [
  "Information Technology",
  "Digital Marketing",
  "Creative & Design",
  "Human Resources & Operations",
];

const shifts = [
  { name: "General Shift", startTime: "09:00", endTime: "18:00", graceMinutes: 15, workingDays: "1,2,3,4,5" },
  { name: "Early Shift", startTime: "08:00", endTime: "17:00", graceMinutes: 10, workingDays: "1,2,3,4,5" },
  { name: "Flexible Marketing Shift", startTime: "10:00", endTime: "19:00", graceMinutes: 15, workingDays: "1,2,3,4,5" },
];

const names = [
  ["Arjun", "Krishnan"], ["Priya", "Raman"], ["Rahul", "Nair"], ["Meera", "Sundaram"], ["Karthik", "Iyer"],
  ["Ananya", "Menon"], ["Vikram", "Rao"], ["Divya", "Narayanan"], ["Sanjay", "Kumar"], ["Kavya", "Shankar"],
  ["Rohit", "Varma"], ["Nisha", "Prakash"], ["Aditya", "Mohan"], ["Sneha", "Reddy"], ["Harish", "Babu"],
  ["Aishwarya", "Raj"], ["Naveen", "Suresh"], ["Pooja", "Sekar"], ["Siddharth", "Jain"], ["Lakshmi", "Devi"],
  ["Manoj", "Kannan"], ["Swathi", "Venkatesh"], ["Akash", "Patel"], ["Deepa", "Muralidhar"], ["Rakesh", "Gupta"],
  ["Keerthana", "Balaji"], ["Surya", "Prakash"], ["Neha", "Kapoor"], ["Ajay", "Sharma"], ["Varsha", "Nambiar"],
  ["Gokul", "Das"], ["Ishita", "Mehta"], ["Pranav", "Joshi"], ["Riya", "Thomas"], ["Ashwin", "Kumar"],
  ["Bhavana", "Pillai"], ["Dinesh", "Chandran"], ["Shreya", "Bose"], ["Nitin", "Malhotra"], ["Janani", "Subramanian"],
  ["Abhishek", "Singh"], ["Madhumitha", "Ravi"], ["Tarun", "Agarwal"], ["Gayathri", "Mohan"], ["Vishal", "Kulkarni"],
  ["Anjali", "George"], ["Suresh", "Naidu"], ["Ramya", "Krishnamurthy"], ["Mohit", "Bansal"], ["Preethi", "Arun"],
];

const jobs = [
  ["Information Technology", "Head of Engineering", 2400000, true],
  ["Information Technology", "Engineering Manager", 1800000, true],
  ["Digital Marketing", "Digital Marketing Manager", 1500000, true],
  ["Creative & Design", "Creative Director", 1440000, true],
  ["Human Resources & Operations", "HR & Operations Manager", 1200000, true],
  ["Information Technology", "Technical Lead", 1500000],
  ["Information Technology", "Senior Backend Engineer", 1320000],
  ["Information Technology", "Senior Frontend Engineer", 1320000],
  ["Information Technology", "Senior Full Stack Engineer", 1380000],
  ["Information Technology", "DevOps Engineer", 1200000],
  ["Information Technology", "Cloud Engineer", 1140000],
  ["Information Technology", "Data Engineer", 1080000],
  ["Information Technology", "Data Analyst", 840000],
  ["Information Technology", "Backend Engineer", 900000],
  ["Information Technology", "Frontend Engineer", 900000],
  ["Information Technology", "Full Stack Engineer", 960000],
  ["Information Technology", "Mobile App Developer", 900000],
  ["Information Technology", "QA Automation Engineer", 780000],
  ["Information Technology", "Quality Analyst", 660000],
  ["Information Technology", "UI Engineer", 720000],
  ["Information Technology", "Junior Software Engineer", 540000],
  ["Information Technology", "Junior Software Engineer", 540000],
  ["Information Technology", "IT Support Specialist", 480000],
  ["Information Technology", "System Administrator", 660000],
  ["Information Technology", "Security Analyst", 840000],
  ["Information Technology", "Software Engineer", 720000],
  ["Information Technology", "Software Engineer", 720000],
  ["Digital Marketing", "SEO Lead", 960000],
  ["Digital Marketing", "Performance Marketing Lead", 1080000],
  ["Digital Marketing", "Social Media Strategist", 720000],
  ["Digital Marketing", "Content Marketing Lead", 840000],
  ["Digital Marketing", "SEO Specialist", 600000],
  ["Digital Marketing", "SEO Specialist", 540000],
  ["Digital Marketing", "PPC Specialist", 660000],
  ["Digital Marketing", "Campaign Analyst", 720000],
  ["Digital Marketing", "Social Media Executive", 480000],
  ["Digital Marketing", "Content Strategist", 660000],
  ["Digital Marketing", "Content Writer", 480000],
  ["Digital Marketing", "Email Marketing Specialist", 600000],
  ["Digital Marketing", "Marketing Automation Specialist", 720000],
  ["Digital Marketing", "Brand Executive", 540000],
  ["Digital Marketing", "Influencer Marketing Executive", 480000],
  ["Digital Marketing", "Digital Marketing Analyst", 660000],
  ["Creative & Design", "Senior UI/UX Designer", 960000],
  ["Creative & Design", "Graphic Designer", 600000],
  ["Creative & Design", "Motion Graphics Designer", 720000],
  ["Creative & Design", "Video Editor", 600000],
  ["Human Resources & Operations", "HR Business Partner", 840000],
  ["Human Resources & Operations", "Talent Acquisition Specialist", 600000],
  ["Human Resources & Operations", "Payroll & Compliance Executive", 660000],
];

const bankByBranch = [
  ["HDFC Bank", "HDFC0000123"],
  ["ICICI Bank", "ICIC0000456"],
  ["State Bank of India", "SBIN0000789"],
  ["Axis Bank", "UTIB0000321"],
];

const roundMoney = (value) => Math.round(Number(value) * 100) / 100;
const slug = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "");
const dateOnly = (year, month, day) => new Date(Date.UTC(year, month, day));

const salaryFor = (annualCtc) => {
  const monthlyCtc = roundMoney(annualCtc / 12);
  const baseSalary = roundMoney(monthlyCtc * 0.4);
  const hra = roundMoney(baseSalary * 0.5);
  const transport = 2000;
  const otherAllowance = 1500;
  const special = roundMoney(monthlyCtc - baseSalary - hra - transport - otherAllowance);
  const pf = Math.min(1800, roundMoney(baseSalary * 0.12));
  const esi = monthlyCtc <= 21000 ? roundMoney(monthlyCtc * 0.0075) : 0;
  const professionalTax = 200;
  return { annualCtc, monthlyCtc, baseSalary, hra, transport, special, otherAllowance, pf, esi, professionalTax, overtimeRate: 1.5 };
};

async function findOrCreate(model, where, data) {
  const existing = await model.findFirst({ where });
  return existing || model.create({ data });
}

async function main() {
  const organizations = await prisma.organization.findMany({
    where: TARGET_ORGANIZATION_ID ? { id: TARGET_ORGANIZATION_ID, deletedAt: null } : { deletedAt: null },
    select: { id: true, name: true, maxEmployees: true, _count: { select: { employees: true, branches: true, departments: true } } },
  });
  if (organizations.length !== 1) {
    throw new Error(`Expected exactly one target organization; found ${organizations.length}. Set SEED_ORGANIZATION_ID explicitly.`);
  }
  const organization = organizations[0];
  const codes = names.map((_, index) => `${SEED_PREFIX}-${String(index + 1).padStart(3, "0")}`);
  const existingSeeded = await prisma.employee.count({ where: { organizationId: organization.id, employeeCode: { in: codes } } });

  console.log(JSON.stringify({
    mode: APPLY ? "apply" : "dry-run",
    organization: organization.name,
    currentEmployees: organization._count.employees,
    existingSeededEmployees: existingSeeded,
    targetSeededEmployees: 50,
    resultingEmployees: organization._count.employees + (50 - existingSeeded),
    emailDomain: "yopmail.com",
    branches: branches.map((item) => item.name),
    departments,
  }, null, 2));
  if (!APPLY) {
    console.log("Dry run only. Re-run with --apply to write production data.");
    return;
  }

  const branchRows = [];
  for (const branch of branches) {
    branchRows.push(await findOrCreate(
      prisma.branch,
      { organizationId: organization.id, name: branch.name },
      { organizationId: organization.id, ...branch },
    ));
  }

  const departmentRows = {};
  for (const name of departments) {
    departmentRows[name] = await prisma.department.upsert({
      where: { organizationId_name: { organizationId: organization.id, name } },
      update: {},
      create: { organizationId: organization.id, name },
    });
  }

  const shiftRows = [];
  for (const shift of shifts) {
    shiftRows.push(await findOrCreate(
      prisma.shift,
      { organizationId: organization.id, name: shift.name },
      { organizationId: organization.id, ...shift },
    ));
  }

  const leaveTypes = [];
  for (const item of [
    { name: "Casual Leave", code: "CL", daysAllowed: 12, isPaid: true },
    { name: "Sick Leave", code: "SL", daysAllowed: 10, isPaid: true },
    { name: "Privilege Leave", code: "PL", daysAllowed: 18, isPaid: true },
    { name: "Loss of Pay", code: "LOP", daysAllowed: 0, isPaid: false },
  ]) {
    leaveTypes.push(await prisma.leaveType.upsert({
      where: { organizationId_code: { organizationId: organization.id, code: item.code } },
      update: { name: item.name, daysAllowed: item.daysAllowed, isPaid: item.isPaid },
      create: { organizationId: organization.id, ...item },
    }));
  }

  await prisma.organization.update({
    where: { id: organization.id },
    data: { maxEmployees: { set: Math.max(100, organization.maxEmployees) }, timezone: "Asia/Kolkata", currency: "INR" },
  });
  await prisma.subscription.updateMany({
    where: { organizationId: organization.id },
    data: { maxEmployees: 100, maxBranches: 10 },
  });
  await prisma.attendancePolicy.upsert({
    where: { organizationId: organization.id },
    update: {},
    create: { organizationId: organization.id, workingDaysPerMonth: 26, allowWfh: true, geofenceStrict: false },
  });

  const employeeData = names.map(([firstName, lastName], index) => {
    const number = index + 1;
    const [departmentName, designation] = jobs[index];
    const branchIndex = index % branchRows.length;
    const shiftIndex = departmentName === "Digital Marketing" ? 2 : index % 2;
    return {
      organizationId: organization.id,
      employeeCode: codes[index],
      firstName,
      lastName,
      workEmail: `${slug(firstName)}.${slug(lastName)}.${String(number).padStart(2, "0")}@yopmail.com`,
      phone: `+91-00000-${String(10000 + number).slice(-5)}`,
      status: number % 11 === 0 ? "PROBATION" : "ACTIVE",
      branchId: branchRows[branchIndex].id,
      departmentId: departmentRows[departmentName].id,
      shiftId: shiftRows[shiftIndex].id,
      designation,
      dateOfJoining: dateOnly(2022 + (number % 4), number % 12, (number % 24) + 1),
      dateOfBirth: dateOnly(1987 + (number % 12), (number * 3) % 12, (number % 24) + 1),
      employmentType: number % 13 === 0 ? "CONTRACT" : "FULL_TIME",
      emergencyContactName: `${lastName} Family Contact`,
      emergencyContactPhone: `+91-00000-${String(20000 + number).slice(-5)}`,
      address: branchRows[branchIndex].address,
      panNumber: `KMDPA${String(number).padStart(4, "0")}X`,
      uanNumber: `10000000${String(number).padStart(4, "0")}`,
      esiNumber: `520000${String(number).padStart(4, "0")}`,
      bankName: bankByBranch[branchIndex][0],
      bankAccountNumber: `90000000${String(number).padStart(4, "0")}`,
      bankIfsc: bankByBranch[branchIndex][1],
    };
  });

  await prisma.employee.createMany({ data: employeeData, skipDuplicates: true });
  const employees = await prisma.employee.findMany({
    where: { organizationId: organization.id, employeeCode: { in: codes } },
    select: { id: true, employeeCode: true, departmentId: true },
  });
  const employeeByCode = new Map(employees.map((employee) => [employee.employeeCode, employee]));

  const managerCodeByDepartment = {
    "Information Technology": "KMD-001",
    "Digital Marketing": "KMD-003",
    "Creative & Design": "KMD-004",
    "Human Resources & Operations": "KMD-005",
  };
  for (const departmentName of departments) {
    const manager = employeeByCode.get(managerCodeByDepartment[departmentName]);
    await prisma.employee.updateMany({
      where: { organizationId: organization.id, departmentId: departmentRows[departmentName].id, id: { not: manager.id }, employeeCode: { in: codes } },
      data: { reportingManagerId: manager.id },
    });
    await prisma.employee.update({ where: { id: manager.id }, data: { reportingManagerId: null } });
  }

  const salaryRows = employeeData.map((data, index) => ({
    organizationId: organization.id,
    employeeId: employeeByCode.get(data.employeeCode).id,
    ...salaryFor(jobs[index][2]),
  }));
  await prisma.salaryStructure.createMany({ data: salaryRows, skipDuplicates: true });

  const existingRevisionEmployeeIds = new Set((await prisma.salaryRevision.findMany({
    where: { organizationId: organization.id, employeeId: { in: employees.map((item) => item.id) }, revisionReason: "INITIAL_DEMO_COMPENSATION" },
    select: { employeeId: true },
  })).map((item) => item.employeeId));
  await prisma.salaryRevision.createMany({
    data: salaryRows.filter((row) => !existingRevisionEmployeeIds.has(row.employeeId)).map((row) => ({
      organizationId: row.organizationId,
      employeeId: row.employeeId,
      annualCtc: row.annualCtc,
      monthlyCtc: row.monthlyCtc,
      baseSalary: row.baseSalary,
      hra: row.hra,
      transport: row.transport,
      special: row.special,
      otherAllowance: row.otherAllowance,
      pf: row.pf,
      esi: row.esi,
      professionalTax: row.professionalTax,
      effectiveDate: dateOnly(SEED_YEAR, 0, 1),
      revisionReason: "INITIAL_DEMO_COMPENSATION",
    })),
  });

  await prisma.leaveBalance.createMany({
    data: employees.flatMap((employee) => leaveTypes.map((leaveType) => ({
      organizationId: organization.id,
      employeeId: employee.id,
      leaveTypeId: leaveType.id,
      year: SEED_YEAR,
      allocatedDays: leaveType.daysAllowed,
      usedDays: 0,
    }))),
    skipDuplicates: true,
  });
  await prisma.compOffBalance.createMany({
    data: employees.map((employee) => ({ organizationId: organization.id, employeeId: employee.id, creditedDays: 0, usedDays: 0 })),
    skipDuplicates: true,
  });

  const previousMonthDate = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 1, 1));
  const payrollMonth = previousMonthDate.getUTCMonth() + 1;
  const payrollYear = previousMonthDate.getUTCFullYear();
  await prisma.payslip.createMany({
    data: salaryRows.map((salary, index) => {
      const tdsDeduction = salary.annualCtc >= 1800000 ? 10000 : salary.annualCtc >= 1200000 ? 5000 : salary.annualCtc >= 800000 ? 2000 : 0;
      const statutoryDeductions = roundMoney(salary.pf + salary.esi + salary.professionalTax);
      const deductionsTotal = roundMoney(statutoryDeductions + tdsDeduction);
      const reimbursements = index % 5 === 0 ? 1000 : 0;
      return {
        organizationId: organization.id,
        employeeId: salary.employeeId,
        month: payrollMonth,
        year: payrollYear,
        workingDays: 26,
        presentDays: 26,
        paidLeaveDays: 0,
        unpaidLeaveDays: 0,
        overtimeHours: 0,
        baseSalary: salary.baseSalary,
        hra: salary.hra,
        transport: salary.transport,
        special: salary.special,
        otherAllowance: salary.otherAllowance,
        allowancesTotal: roundMoney(salary.hra + salary.transport + salary.special + salary.otherAllowance),
        overtimePay: 0,
        grossSalary: salary.monthlyCtc,
        unpaidLeaveDeduction: 0,
        lateDeduction: 0,
        pfDeduction: salary.pf,
        esiDeduction: salary.esi,
        ptDeduction: salary.professionalTax,
        statutoryDeductions,
        tdsDeduction,
        deductionsTotal,
        netSalary: roundMoney(salary.monthlyCtc - deductionsTotal + reimbursements),
        reimbursements,
        loanRecovery: 0,
        status: "DISBURSED",
        approvedAt: new Date(Date.UTC(payrollYear, payrollMonth, 1)),
        disbursedAt: new Date(Date.UTC(payrollYear, payrollMonth, 3)),
        remarks: "Synthetic workforce seed — completed payroll cycle",
      };
    }),
    skipDuplicates: true,
  });

  await prisma.payslipTemplate.upsert({
    where: { organizationId: organization.id },
    update: {},
    create: {
      organizationId: organization.id,
      name: "Kerplunkmedia Professional",
      templateKey: "MODERN_CORPORATE",
      companyName: organization.name,
      addressLine1: "Puducherry, India",
      contactEmail: "payroll.kerplunkmedia@yopmail.com",
      primaryColor: "#4f46e5",
      accentColor: "#0f172a",
      signatoryName: "HR Operations",
      signatoryTitle: "Authorized Signatory",
      footerNotes: "Confidential synthetic payroll record for product demonstration.",
    },
  });

  const summary = await prisma.organization.findUnique({
    where: { id: organization.id },
    select: {
      name: true,
      _count: { select: { employees: true, branches: true, departments: true, shifts: true, salaryStructures: true, payslips: true } },
    },
  });
  console.log("Seed complete:", JSON.stringify(summary, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
