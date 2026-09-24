const bcrypt = require("bcryptjs");
const prisma = require("../config/database");
const emailService = require("./email.service");
const { generateTempPassword, resolveAssignableRole } = require("../utils/password");
const { resolveAvatarUrl } = require("../utils/avatar");

/**
 * 1. POST /api/employees - Create Employee
 */
const createEmployee = async (organizationId, data, actorRole = "COMPANY_ADMIN") => {
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

  const existingUser = await prisma.user.findUnique({
    where: {
      organizationId_email: { organizationId, email: cleanEmail },
    },
  });

  if (existingUser) {
    throw new Error(`A user account with email '${cleanEmail}' already exists in this organization`);
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
  if (!org) throw new Error("Organization not found.");
  if (org.planLocked) {
    const err = new Error("Your plan is locked. Activate the plan before adding employees.");
    err.statusCode = 403;
    throw err;
  }
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

  const tempPassword = password && String(password).trim() ? String(password).trim() : generateTempPassword();
  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(tempPassword, salt);
  const userRole = resolveAssignableRole(role, actorRole);

  const avatarUrl = resolveAvatarUrl({
    avatarUrl: data.avatarUrl,
    profileImage: data.profileImage,
    profilePicture: data.profilePicture,
    avatar: data.avatar,
    firstName: firstName.trim(),
    lastName: lastName ? lastName.trim() : null,
    employeeCode: finalEmployeeCode,
  });

  // Atomic creation of User + Employee
  const createdEmployee = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: cleanEmail,
        passwordHash,
        role: userRole,
        organizationId,
        avatarUrl,
        mustChangePassword: true,
        isActive: true,
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
        avatarUrl,
        status: "ACTIVE",
        branchId: branchId || null,
        departmentId: departmentId || null,
        shiftId: shiftId || null,
        designation: data.designation ? String(data.designation).trim() : null,
        dateOfJoining: data.dateOfJoining ? new Date(data.dateOfJoining) : null,
        dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth) : null,
        employmentType: data.employmentType ? String(data.employmentType).trim() : null,
        reportingManagerId: data.reportingManagerId || null,
        workEmail: cleanEmail,
        panNumber: data.panNumber ? String(data.panNumber).trim().toUpperCase() : null,
        uanNumber: data.uanNumber ? String(data.uanNumber).trim() : null,
        esiNumber: data.esiNumber ? String(data.esiNumber).trim() : null,
        bankName: data.bankName ? String(data.bankName).trim() : null,
        bankAccountNumber: data.bankAccountNumber ? String(data.bankAccountNumber).trim() : null,
        bankIfsc: data.bankIfsc ? String(data.bankIfsc).trim().toUpperCase() : null,
        emergencyContactName: data.emergencyContactName ? String(data.emergencyContactName).trim() : null,
        emergencyContactPhone: data.emergencyContactPhone ? String(data.emergencyContactPhone).trim() : null,
        address: data.address ? String(data.address).trim() : null,
      },
      include: {
        user: {
          select: { id: true, email: true, role: true, avatarUrl: true },
        },
        branch: true,
        department: true,
        shift: true,
      },
    });

    return employee;
  });

  if (data.ctc) {
    try {
      const payrollService = require("./payroll.service");
      const annualCtc = Number(data.ctc);
      const monthly = annualCtc / 12;
      await payrollService.upsertSalaryStructure(organizationId, {
        employeeId: createdEmployee.id,
        annualCtc,
        monthlyCtc: monthly,
        baseSalary: Math.round(monthly * 0.5),
        hra: Math.round(monthly * 0.25),
        special: Math.round(monthly * 0.15),
        otherAllowance: Math.round(monthly * 0.1),
      });
    } catch (err) {
      console.warn("[CreateEmployee] CTC structure skipped:", err.message);
    }
  }

  // Dispatch welcome email with credentials
  const loginUrl = `${process.env.FRONTEND_URL || "http://localhost:3000"}/login`;
  emailService.sendEmployeeWelcomeEmail(
    cleanEmail,
    firstName.trim(),
    {
      organizationName: org?.name || "WorkPulse",
      tempPassword,
      loginUrl,
      role: userRole,
    }
  ).catch((err) => console.warn("[CreateEmployee] Welcome email dispatch failed:", err.message));

  return createdEmployee;
};

/**
 * 2. GET /api/employees - List Employees
 */
const getEmployees = async (organizationId, query = {}) => {
  const take = Math.min(500, Math.max(1, parseInt(query.limit, 10) || 50));
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const skip = (page - 1) * take;
  const where = { organizationId, deletedAt: null };
  if (query.status) {
    where.status = query.status;
  }
  if (query.search) {
    const q = String(query.search).trim();
    if (q) {
      where.OR = [
        { firstName: { contains: q, mode: "insensitive" } },
        { lastName: { contains: q, mode: "insensitive" } },
        { employeeCode: { contains: q, mode: "insensitive" } },
        { user: { email: { contains: q, mode: "insensitive" } } },
      ];
    }
  }

  const [records, total] = await Promise.all([
    prisma.employee.findMany({
      where,
      include: {
        user: {
          select: { id: true, email: true, role: true, avatarUrl: true },
        },
        branch: true,
        department: true,
        shift: true,
      },
      orderBy: { createdAt: "desc" },
      take,
      skip,
    }),
    prisma.employee.count({ where }),
  ]);

  return { records, total, page, limit: take, totalPages: Math.ceil(total / take) || 1 };
};

/**
 * 3. GET /api/employees/:id - Get Employee by ID
 */
const getEmployeeById = async (organizationId, employeeId) => {
  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, organizationId, deletedAt: null },
    include: {
      user: {
        select: { id: true, email: true, role: true, avatarUrl: true },
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
    designation,
    dateOfJoining,
    dateOfBirth,
    employmentType,
    reportingManagerId,
    workEmail,
    panNumber,
    uanNumber,
    esiNumber,
    bankName,
    bankAccountNumber,
    bankIfsc,
    emergencyContactName,
    emergencyContactPhone,
    address,
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

  const avatarToSet = data.avatarUrl !== undefined ? data.avatarUrl : (
    data.profileImage !== undefined ? data.profileImage : (
      data.profilePicture !== undefined ? data.profilePicture : data.avatar
    )
  );

  return await prisma.$transaction(async (tx) => {
    if (employee.userId && (role || avatarToSet !== undefined)) {
      const userUpdates = {};
      if (role) {
        userUpdates.role = (role === 'HR' || role === 'MANAGER') ? 'MANAGER' : role;
      }
      if (avatarToSet !== undefined) {
        userUpdates.avatarUrl = avatarToSet ? String(avatarToSet).trim() : null;
      }
      await tx.user.update({
        where: { id: employee.userId },
        data: userUpdates,
      });
    }

    return await tx.employee.update({
      where: { id: employeeId },
      data: {
        ...(avatarToSet !== undefined ? { avatarUrl: avatarToSet ? String(avatarToSet).trim() : null } : {}),
        ...(firstName ? { firstName: firstName.trim() } : {}),
        ...(lastName !== undefined ? { lastName: lastName?.trim() || null } : {}),
        ...(phone !== undefined ? { phone: phone?.trim() || null } : {}),
        ...(status ? { status } : {}),
        ...(employeeCode ? { employeeCode: employeeCode.trim() } : {}),
        ...(branchId !== undefined ? { branchId: branchId || null } : {}),
        ...(departmentId !== undefined ? { departmentId: departmentId || null } : {}),
        ...(shiftId !== undefined ? { shiftId: shiftId || null } : {}),
        ...(designation !== undefined ? { designation: designation ? String(designation).trim() : null } : {}),
        ...(dateOfJoining !== undefined ? { dateOfJoining: dateOfJoining ? new Date(dateOfJoining) : null } : {}),
        ...(dateOfBirth !== undefined ? { dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null } : {}),
        ...(employmentType !== undefined ? { employmentType: employmentType ? String(employmentType).trim() : null } : {}),
        ...(reportingManagerId !== undefined ? { reportingManagerId: reportingManagerId || null } : {}),
        ...(workEmail !== undefined ? { workEmail: workEmail ? String(workEmail).trim().toLowerCase() : null } : {}),
        ...(panNumber !== undefined ? { panNumber: panNumber ? String(panNumber).trim().toUpperCase() : null } : {}),
        ...(uanNumber !== undefined ? { uanNumber: uanNumber ? String(uanNumber).trim() : null } : {}),
        ...(esiNumber !== undefined ? { esiNumber: esiNumber ? String(esiNumber).trim() : null } : {}),
        ...(bankName !== undefined ? { bankName: bankName ? String(bankName).trim() : null } : {}),
        ...(bankAccountNumber !== undefined ? { bankAccountNumber: bankAccountNumber ? String(bankAccountNumber).trim() : null } : {}),
        ...(bankIfsc !== undefined ? { bankIfsc: bankIfsc ? String(bankIfsc).trim().toUpperCase() : null } : {}),
        ...(emergencyContactName !== undefined ? { emergencyContactName: emergencyContactName ? String(emergencyContactName).trim() : null } : {}),
        ...(emergencyContactPhone !== undefined ? { emergencyContactPhone: emergencyContactPhone ? String(emergencyContactPhone).trim() : null } : {}),
        ...(address !== undefined ? { address: address ? String(address).trim() : null } : {}),
      },
      include: {
        user: { select: { id: true, email: true, role: true, avatarUrl: true } },
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
    await tx.employee.update({
      where: { id: employeeId },
      data: {
        deletedAt: new Date(),
        status: "INACTIVE",
      },
    });

    if (employee.userId) {
      await tx.user.update({
        where: { id: employee.userId },
        data: { isActive: false },
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

  const existing = await prisma.user.findUnique({
    where: { organizationId_email: { organizationId, email: cleanEmail } },
  });
  if (existing) throw new Error(`A user with email '${cleanEmail}' already exists in this organization.`);

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
  const tempPassword = generateTempPassword();
  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(tempPassword, salt);

  // Determine employee code
  const employeeCode = data.employeeCode?.trim() || `EMP-${Date.now().toString().slice(-6)}`;
  const userRole = (role === "HR" || role === "MANAGER") ? "MANAGER" : "EMPLOYEE";
  const avatarUrl = resolveAvatarUrl({
    avatarUrl: data.avatarUrl,
    profileImage: data.profileImage,
    profilePicture: data.profilePicture,
    avatar: data.avatar,
    firstName: firstName.trim(),
    lastName: lastName ? lastName.trim() : null,
    employeeCode,
  });

  // Atomic: create User + Employee
  const { user, employee } = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: cleanEmail,
        passwordHash,
        role: userRole,
        organizationId,
        avatarUrl,
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
        avatarUrl,
        status: "ACTIVE",
        branchId: branchId || null,
        departmentId: departmentId || null,
        shiftId: shiftId || null,
        panNumber: data.panNumber ? String(data.panNumber).trim().toUpperCase() : null,
        uanNumber: data.uanNumber ? String(data.uanNumber).trim() : null,
        esiNumber: data.esiNumber ? String(data.esiNumber).trim() : null,
      },
      include: {
        user: { select: { id: true, email: true, role: true, avatarUrl: true, mustChangePassword: true } },
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
        tempPassword: passwordHash,
        employeeId: employee.id,
        userId: user.id,
        status: "ACCEPTED",
        invitedBy: invitedByUserId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      },
    });

    return { user, employee };
  });

  if (data.ctc) {
    try {
      const payrollService = require("./payroll.service");
      const annualCtc = Number(data.ctc);
      const monthly = annualCtc / 12;
      await payrollService.upsertSalaryStructure(organizationId, {
        employeeId: employee.id,
        annualCtc,
        monthlyCtc: monthly,
        baseSalary: Math.round(monthly * 0.5),
        hra: Math.round(monthly * 0.25),
        special: Math.round(monthly * 0.15),
        otherAllowance: Math.round(monthly * 0.1),
      });
    } catch (err) {
      console.warn("[InviteEmployee] CTC structure skipped:", err.message);
    }
  }

  // Send welcome email with credentials
  const loginUrl = `${process.env.FRONTEND_URL || "http://localhost:3000"}/login`;
  let emailDelivery = null;
  try {
    emailDelivery = await emailService.sendEmployeeWelcomeEmail(
      cleanEmail,
      firstName.trim(),
      {
        organizationName: org.name,
        tempPassword,
        loginUrl,
        role: userRole,
      }
    );
    console.log(`[Invite] Welcome email dispatch result for ${cleanEmail}:`, emailDelivery);
  } catch (err) {
    console.warn("[Invite] Welcome email failed:", err.message);
  }

  // Log to console for simulation/dev mode
  console.log("────────────────────────────────────────────────────────────");
  console.log(`[Invite] Employee: ${firstName} ${lastName || ""} <${cleanEmail}>`);
  console.log("────────────────────────────────────────────────────────────");

  return {
    success: true,
    message: `Invitation processed for ${cleanEmail}. Login credentials dispatched.`,
    employee,
    tempPassword, // returned in response so admin can share it manually if email fails
    emailDelivery,
  };
};

const getMyEmployee = async (organizationId, userId) => {
  const employee = await prisma.employee.findFirst({
    where: { organizationId, userId, deletedAt: null },
    include: { branch: true, department: true, shift: true, user: { select: { id: true, email: true, role: true } } },
  });
  if (!employee) {
    const err = new Error("Employee profile not found");
    err.statusCode = 404;
    throw err;
  }
  return employee;
};

const updateMyProfile = async (organizationId, userId, data) => {
  const employee = await getMyEmployee(organizationId, userId);
  if (data.branchId) {
    const branch = await prisma.branch.findFirst({
      where: { id: String(data.branchId), organizationId },
    });
    if (!branch) throw new Error("Branch not found in this organization");
  }
  const avatarToSet = data.avatarUrl !== undefined ? data.avatarUrl : (
    data.profileImage !== undefined ? data.profileImage : (
      data.profilePicture !== undefined ? data.profilePicture : data.avatar
    )
  );

  return prisma.$transaction(async (tx) => {
    if (avatarToSet !== undefined && userId) {
      await tx.user.update({
        where: { id: userId },
        data: { avatarUrl: avatarToSet ? String(avatarToSet).trim() : null },
      });
    }

    return tx.employee.update({
      where: { id: employee.id },
      data: {
        ...(avatarToSet !== undefined ? { avatarUrl: avatarToSet ? String(avatarToSet).trim() : null } : {}),
        ...(data.phone !== undefined ? { phone: data.phone ? String(data.phone).trim() : null } : {}),
        ...(data.address !== undefined ? { address: data.address ? String(data.address).trim() : null } : {}),
        ...(data.emergencyContactName !== undefined
          ? { emergencyContactName: data.emergencyContactName ? String(data.emergencyContactName).trim() : null }
          : {}),
        ...(data.emergencyContactPhone !== undefined
          ? { emergencyContactPhone: data.emergencyContactPhone ? String(data.emergencyContactPhone).trim() : null }
          : {}),
        ...(data.dateOfBirth !== undefined ? { dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth) : null } : {}),
        ...(data.bankName !== undefined ? { bankName: data.bankName ? String(data.bankName).trim() : null } : {}),
        ...(data.bankAccountNumber !== undefined
          ? { bankAccountNumber: data.bankAccountNumber ? String(data.bankAccountNumber).trim() : null }
          : {}),
          ...(data.bankIfsc !== undefined ? { bankIfsc: data.bankIfsc ? String(data.bankIfsc).trim().toUpperCase() : null } : {}),
          ...(data.branchId !== undefined
            ? { branchId: data.branchId ? String(data.branchId) : null }
            : {}),
      },
      include: { branch: true, department: true, shift: true, user: { select: { id: true, email: true, role: true, avatarUrl: true } } },
    });
  });
};

module.exports = {
  createEmployee,
  getEmployees,
  getEmployeeById,
  updateEmployee,
  deleteEmployee,
  inviteEmployee,
  getMyEmployee,
  updateMyProfile,
};
