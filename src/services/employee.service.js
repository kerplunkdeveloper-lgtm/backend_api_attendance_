const bcrypt = require("bcryptjs");
const prisma = require("../config/database");

/**
 * 1. POST /api/employees - Create Employee
 */
const createEmployee = async (organizationId, data) => {
  const {
    firstName,
    lastName,
    email,
    password,
    role = "EMPLOYEE",
    employeeCode,
    phone,
    branchId,
    departmentId,
    shiftId,
  } = data;

  if (!firstName || !firstName.trim()) {
    throw new Error("First name is required");
  }

  if (!email || !email.trim()) {
    throw new Error("Employee email is required");
  }

  const cleanEmail = email.trim().toLowerCase();

  // Check unique email
  const existingUser = await prisma.user.findUnique({
    where: { email: cleanEmail },
  });

  if (existingUser) {
    throw new Error(`A user account with email '${cleanEmail}' already exists`);
  }

  // Generate or validate employeeCode
  const finalEmployeeCode =
    employeeCode?.trim() || `EMP-${Date.now().toString().slice(-6)}`;

  const existingCode = await prisma.employee.findUnique({
    where: {
      organizationId_employeeCode: {
        organizationId,
        employeeCode: finalEmployeeCode,
      },
    },
  });

  if (existingCode) {
    throw new Error(`Employee code '${finalEmployeeCode}' is already taken in this organization`);
  }

  // Check organization subscription limit
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    include: { subscription: true },
  });
  if (org) {
    const activeEmployeesCount = await prisma.employee.count({
      where: { organizationId, status: "ACTIVE" },
    });
    const maxAllowed = org.subscription?.maxEmployees || org.maxEmployees || 10;
    if (activeEmployeesCount >= maxAllowed) {
      throw new Error(
        `Employee limit reached for your current plan (${maxAllowed} max active employees). Please upgrade your subscription to add more team members.`
      );
    }
  }

  // Validate branch
  if (branchId) {
    const branch = await prisma.branch.findFirst({
      where: { id: branchId, organizationId },
    });
    if (!branch) throw new Error("Specified branch does not exist in this organization");
  }

  // Validate department
  if (departmentId) {
    const department = await prisma.department.findFirst({
      where: { id: departmentId, organizationId },
    });
    if (!department) throw new Error("Specified department does not exist in this organization");
  }

  // Validate shift
  if (shiftId) {
    const shift = await prisma.shift.findFirst({
      where: { id: shiftId, organizationId },
    });
    if (!shift) throw new Error("Specified shift does not exist in this organization");
  }

  // Hash login password
  const defaultPassword = password || "WorkPulse123!";
  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(defaultPassword, salt);

  const userRole = (role === 'HR' || role === 'MANAGER') ? 'MANAGER' : role;

  // Atomic creation of User + Employee
  return await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: cleanEmail,
        passwordHash,
        role: userRole,
        organizationId,
      },
    });

    const employee = await tx.employee.create({
      data: {
        organizationId,
        userId: user.id,
        employeeCode: finalEmployeeCode,
        firstName: firstName.trim(),
        lastName: lastName ? lastName.trim() : null,
        phone: phone ? phone.trim() : null,
        status: "ACTIVE",
        branchId: branchId || null,
        departmentId: departmentId || null,
        shiftId: shiftId || null,
      },
      include: {
        user: {
          select: { id: true, email: true, role: true },
        },
        branch: true,
        department: true,
        shift: true,
      },
    });

    return employee;
  });
};

/**
 * 2. GET /api/employees - List Employees
 */
const getEmployees = async (organizationId) => {
  return await prisma.employee.findMany({
    where: { organizationId },
    include: {
      user: {
        select: { id: true, email: true, role: true },
      },
      branch: true,
      department: true,
      shift: true,
    },
    orderBy: { createdAt: "desc" },
  });
};

/**
 * 3. GET /api/employees/:id - Get Employee by ID
 */
const getEmployeeById = async (organizationId, employeeId) => {
  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, organizationId },
    include: {
      user: {
        select: { id: true, email: true, role: true },
      },
      branch: true,
      department: true,
      shift: true,
      attendances: {
        take: 10,
        orderBy: { date: "desc" },
      },
    },
  });

  if (!employee) {
    throw new Error("Employee not found");
  }

  return employee;
};

/**
 * 4. PUT /api/employees/:id - Update Employee
 */
const updateEmployee = async (organizationId, employeeId, data) => {
  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, organizationId },
    include: { user: true },
  });

  if (!employee) {
    throw new Error("Employee not found");
  }

  const {
    firstName,
    lastName,
    phone,
    status,
    branchId,
    departmentId,
    shiftId,
    role,
    employeeCode,
  } = data;

  if (branchId) {
    const branch = await prisma.branch.findFirst({
      where: { id: branchId, organizationId },
    });
    if (!branch) throw new Error("Branch not found in this organization");
  }

  if (departmentId) {
    const dept = await prisma.department.findFirst({
      where: { id: departmentId, organizationId },
    });
    if (!dept) throw new Error("Department not found in this organization");
  }

  if (shiftId) {
    const shift = await prisma.shift.findFirst({
      where: { id: shiftId, organizationId },
    });
    if (!shift) throw new Error("Shift not found in this organization");
  }

  return await prisma.$transaction(async (tx) => {
    if (role && employee.userId) {
      const userRole = (role === 'HR' || role === 'MANAGER') ? 'MANAGER' : role;
      await tx.user.update({
        where: { id: employee.userId },
        data: { role: userRole },
      });
    }

    return await tx.employee.update({
      where: { id: employeeId },
      data: {
        ...(firstName ? { firstName: firstName.trim() } : {}),
        ...(lastName !== undefined ? { lastName: lastName?.trim() || null } : {}),
        ...(phone !== undefined ? { phone: phone?.trim() || null } : {}),
        ...(status ? { status } : {}),
        ...(employeeCode ? { employeeCode: employeeCode.trim() } : {}),
        ...(branchId !== undefined ? { branchId: branchId || null } : {}),
        ...(departmentId !== undefined ? { departmentId: departmentId || null } : {}),
        ...(shiftId !== undefined ? { shiftId: shiftId || null } : {}),
      },
      include: {
        user: { select: { id: true, email: true, role: true } },
        branch: true,
        department: true,
        shift: true,
      },
    });
  });
};

/**
 * 5. DELETE /api/employees/:id - Delete Employee
 */
const deleteEmployee = async (organizationId, employeeId) => {
  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, organizationId },
  });

  if (!employee) {
    throw new Error("Employee not found");
  }

  return await prisma.$transaction(async (tx) => {
    // Delete any dependent attendance records
    await tx.attendance.deleteMany({
      where: { employeeId },
    });

    await tx.employee.delete({
      where: { id: employeeId },
    });

    if (employee.userId) {
      await tx.user.delete({
        where: { id: employee.userId },
      });
    }

    return { success: true };
  });
};

/**
 * 6. POST /api/employees/invite — Admin invites an employee by email.
 * Auto-creates User+Employee account, sends welcome email with temp credentials.
 */
const inviteEmployee = async (organizationId, invitedByUserId, data) => {
  const emailService = require("./email.service");
  const {
    firstName,
    lastName,
    email,
    role = "EMPLOYEE",
    branchId,
    departmentId,
    shiftId,
  } = data;

  if (!firstName || !firstName.trim()) throw new Error("First name is required.");
  if (!email || !email.trim()) throw new Error("Employee email is required.");

  const cleanEmail = email.trim().toLowerCase();

  // Check email uniqueness
  const existing = await prisma.user.findUnique({ where: { email: cleanEmail } });
  if (existing) throw new Error(`A user with email '${cleanEmail}' already exists.`);

  // Check plan lock — must be unlocked before inviting
  const org = await prisma.organization.findUnique({ where: { id: organizationId } });
  if (!org) throw new Error("Organization not found.");
  if (org.planLocked) {
    const err = new Error("Your plan is locked. Please activate your plan before inviting employees.");
    err.statusCode = 403;
    throw err;
  }

  // Check employee seat limit
  const activeCount = await prisma.employee.count({ where: { organizationId, status: "ACTIVE" } });
  const maxAllowed = org.maxEmployees || 10;
  if (activeCount >= maxAllowed) {
    throw new Error(`Employee seat limit reached (${maxAllowed} max). Upgrade your plan to add more.`);
  }

  // Generate temp password: TMP-XXXXXX + 4 random digits
  const tempPassword = `TMP-${Math.random().toString(36).slice(2, 8).toUpperCase()}${Math.floor(1000 + Math.random() * 9000)}`;
  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(tempPassword, salt);

  // Determine employee code
  const employeeCode = `EMP-${Date.now().toString().slice(-6)}`;
  const userRole = (role === "HR" || role === "MANAGER") ? "MANAGER" : "EMPLOYEE";

  // Atomic: create User + Employee
  const { user, employee } = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: cleanEmail,
        passwordHash,
        role: userRole,
        organizationId,
        mustChangePassword: true, // force password change on first login
        isActive: true,
      },
    });

    const employee = await tx.employee.create({
      data: {
        organizationId,
        userId: user.id,
        employeeCode,
        firstName: firstName.trim(),
        lastName: lastName ? lastName.trim() : null,
        status: "ACTIVE",
        branchId: branchId || null,
        departmentId: departmentId || null,
        shiftId: shiftId || null,
      },
      include: {
        user: { select: { id: true, email: true, role: true, mustChangePassword: true } },
        branch: true,
        department: true,
        shift: true,
      },
    });

    // Log invite record
    await tx.employeeInvite.create({
      data: {
        organizationId,
        email: cleanEmail,
        firstName: firstName.trim(),
        lastName: lastName ? lastName.trim() : null,
        role: userRole,
        tempPassword, // plaintext stored in invite log for audit
        employeeId: employee.id,
        userId: user.id,
        status: "ACCEPTED",
        invitedBy: invitedByUserId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      },
    });

    return { user, employee };
  });

  // Send welcome email with credentials (async — don't block response)
  const loginUrl = `${process.env.FRONTEND_URL || "http://localhost:3000"}/login`;
  emailService.sendEmployeeWelcomeEmail(
    cleanEmail,
    firstName.trim(),
    {
      organizationName: org.name,
      tempPassword,
      loginUrl,
      role: userRole,
    }
  ).catch((err) => console.warn("[Invite] Welcome email failed:", err.message));

  // Log to console for simulation/dev mode
  console.log("────────────────────────────────────────────────────────────");
  console.log(`[Invite] Employee: ${firstName} ${lastName || ""} <${cleanEmail}>`);
  console.log(`[Invite] Temp Password: ${tempPassword}`);
  console.log("────────────────────────────────────────────────────────────");

  return {
    success: true,
    message: `Invitation sent to ${cleanEmail}. They will receive login credentials by email.`,
    employee,
    tempPassword, // returned in response so admin can share it manually if email fails
  };
};

module.exports = {
  createEmployee,
  getEmployees,
  getEmployeeById,
  updateEmployee,
  deleteEmployee,
  inviteEmployee,
};

