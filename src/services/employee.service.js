const bcrypt = require("bcryptjs");
const prisma = require("../config/database");
const emailService = require("./email.service");
const { generateTempPassword, resolveAssignableRole, assertRoleAssignment } = require("../utils/password");
const { resolveAvatarUrl } = require("../utils/avatar");
const { assertSeatAvailable, assertBranchAvailable } = require("./entitlement.service");

const SENSITIVE_EMPLOYEE_FIELDS = [
  "panNumber",
  "uanNumber",
  "esiNumber",
  "bankName",
  "bankAccountNumber",
  "bankIfsc",
  "dateOfBirth",
  "address",
  "emergencyContactName",
  "emergencyContactPhone",
];

const withoutSensitiveEmployeeFields = (employee) => {
  if (!employee) return employee;
  const safe = { ...employee };
  for (const field of SENSITIVE_EMPLOYEE_FIELDS) delete safe[field];
  return safe;
};

const GENDER_VALUES = ["MALE", "FEMALE"];

/** Blank means "not recorded". Anything else must be Male or Female. */
const normalizeGender = (value) => {
  if (value === undefined || value === null || String(value).trim() === "" || String(value).trim().toUpperCase() === "NOT_SPECIFIED") return null;
  const gender = String(value).trim().toUpperCase();
  if (!GENDER_VALUES.includes(gender)) {
    throw Object.assign(new Error("Gender must be Male or Female"), { statusCode: 400 });
  }
  return gender;
};

const MANAGER_UPDATE_FIELDS = new Set([
  "firstName", "lastName", "phone", "status", "branchId", "departmentId",
  "shiftId", "designation", "employmentType", "reportingManagerId", "avatarUrl",
  "profileImage", "profilePicture", "avatar", "role",
]);

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
  const gender = normalizeGender(data.gender);

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

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    include: { subscription: true },
  });
  if (!org) throw new Error("Organization not found.");

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

  if (data.reportingManagerId) {
    // Reporting manager must be a colleague in the same organization.
    const manager = await prisma.employee.findFirst({ where: { id: String(data.reportingManagerId), organizationId, deletedAt: null }, select: { id: true } });
    if (!manager) throw Object.assign(new Error("Reporting manager not found in this organization"), { statusCode: 400 });
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
    await assertSeatAvailable(organizationId, tx);
    const user = await tx.user.create({
      data: {
        email: cleanEmail,
        passwordHash,
        role: userRole,
        organizationId,
        avatarUrl,
        mustChangePassword: true,
        isActive: true,
        // Admin-invited, not self-registered — the admin already vouches for this address.
        emailVerifiedAt: new Date(),
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
        gender,
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
      companyLogoUrl: org?.logoUrl,
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
  const VALID_STATUSES = ["ACTIVE", "INACTIVE", "TERMINATED", "PROBATION", "NOTICE_PERIOD"];
  const VALID_ROLES = ["SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER", "EMPLOYEE"];
  const asText = (v) => (typeof v === "string" ? v.trim() : "");
  if (VALID_STATUSES.includes(asText(query.status))) where.status = asText(query.status);
  if (asText(query.departmentId)) where.departmentId = asText(query.departmentId);
  if (asText(query.branchId)) where.branchId = asText(query.branchId);
  if (asText(query.shiftId)) where.shiftId = asText(query.shiftId);
  if (VALID_ROLES.includes(asText(query.role))) where.user = { role: asText(query.role) };
  // Login access is separate from employment status: OFF means the account was deactivated.
  if (query.loginAccess === "ON" || query.loginAccess === "OFF") {
    where.user = { ...(where.user || {}), isActive: query.loginAccess === "ON" };
  }
  if (query.search) {
    const q = String(query.search).trim();
    if (q) {
      where.OR = [
        { firstName: { contains: q, mode: "insensitive" } },
        { lastName: { contains: q, mode: "insensitive" } },
        { employeeCode: { contains: q, mode: "insensitive" } },
        { designation: { contains: q, mode: "insensitive" } },
        { user: { email: { contains: q, mode: "insensitive" } } },
      ];
    }
  }

  const [records, total] = await Promise.all([
    prisma.employee.findMany({
      where,
      include: {
        user: {
          select: { id: true, email: true, role: true, avatarUrl: true, isActive: true },
        },
        branch: true,
        department: true,
        shift: true,
        // Route is limited to admins and managers, so the salary column is safe here.
        salaryStructure: { select: { annualCtc: true, monthlyCtc: true } },
      },
      orderBy: { createdAt: "desc" },
      take,
      skip,
    }),
    prisma.employee.count({ where }),
  ]);

  return {
    records: records.map(withoutSensitiveEmployeeFields),
    total,
    page,
    limit: take,
    totalPages: Math.ceil(total / take) || 1,
  };
};

/**
 * 3. GET /api/employees/:id - Get Employee by ID
 */
const getEmployeeById = async (organizationId, employeeId, actorRole = "EMPLOYEE") => {
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

  return ["SUPER_ADMIN", "COMPANY_ADMIN"].includes(actorRole)
    ? employee
    : withoutSensitiveEmployeeFields(employee);
};

/**
 * 4. PUT /api/employees/:id - Update Employee
 */
const updateEmployee = async (organizationId, employeeId, data, actor = {}) => {
  const actorRole = actor.actorRole || actor.role || "COMPANY_ADMIN";
  const actorUserId = actor.actorUserId || actor.id || null;

  if (actorRole === "MANAGER") {
    const forbidden = Object.keys(data).filter((key) => !MANAGER_UPDATE_FIELDS.has(key));
    if (forbidden.length) {
      const error = new Error(`Managers cannot update: ${forbidden.join(", ")}`);
      error.statusCode = 403;
      throw error;
    }
  }

  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, organizationId },
    include: { user: true },
  });

  if (!employee) {
    throw new Error("Employee not found");
  }

  if (actorRole === "MANAGER" && employee.user?.role && employee.user.role !== "EMPLOYEE") {
    const error = new Error("Managers can only update employee accounts");
    error.statusCode = 403;
    throw error;
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
    gender,
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

  const genderToSet = gender !== undefined ? normalizeGender(gender) : undefined;

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

  if (reportingManagerId) {
    // Reporting manager must be a colleague in the same organization.
    const manager = await prisma.employee.findFirst({ where: { id: String(reportingManagerId), organizationId, deletedAt: null }, select: { id: true } });
    if (!manager) throw Object.assign(new Error("Reporting manager not found in this organization"), { statusCode: 400 });
  }

  const avatarToSet = data.avatarUrl !== undefined ? data.avatarUrl : (
    data.profileImage !== undefined ? data.profileImage : (
      data.profilePicture !== undefined ? data.profilePicture : data.avatar
    )
  );

  const updatedEmployee = await prisma.$transaction(async (tx) => {
    if (employee.userId && (role || avatarToSet !== undefined)) {
      const userUpdates = {};
      if (role) {
        userUpdates.role = assertRoleAssignment({
          requestedRole: role,
          actorRole,
          actorUserId,
          targetUserId: employee.userId,
          targetRole: employee.user?.role,
        });
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
        ...(genderToSet !== undefined ? { gender: genderToSet } : {}),
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
  return actorRole === "MANAGER"
    ? withoutSensitiveEmployeeFields(updatedEmployee)
    : updatedEmployee;
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

const BULK_ACCESS_MAX = 200;
const ADMIN_ROLES = ["SUPER_ADMIN", "COMPANY_ADMIN"];

/**
 * Deactivate or reactivate several employees' logins at once.
 *
 * DEACTIVATE: the account can no longer sign in (existing sessions are
 * rejected on their next request), the seat is released, and every record is
 * kept. ACTIVATE reverses it, if the plan still has a free seat.
 *
 * Every id is scoped to the caller's organization. Protected accounts are
 * reported per id instead of failing the whole request:
 *  - your own account can never be deactivated
 *  - only a SUPER_ADMIN may deactivate SUPER_ADMIN / COMPANY_ADMIN accounts
 *  - terminated employees cannot be reactivated here
 */
const setEmployeesAccess = async (organizationId, employeeIds, action, actor = {}) => {
  if (action !== "DEACTIVATE" && action !== "ACTIVATE") throw badRequest("Action must be DEACTIVATE or ACTIVATE");
  const ids = [...new Set((Array.isArray(employeeIds) ? employeeIds : []).filter((id) => typeof id === "string" && id.trim()))];
  if (ids.length === 0) throw badRequest("Select at least one employee");
  if (ids.length > BULK_ACCESS_MAX) throw badRequest(`You can update up to ${BULK_ACCESS_MAX} employees at a time`);

  const found = await prisma.employee.findMany({
    where: { id: { in: ids }, organizationId, deletedAt: null },
    select: {
      id: true,
      userId: true,
      status: true,
      firstName: true,
      lastName: true,
      user: { select: { id: true, role: true, isActive: true } },
    },
  });
  const byId = new Map(found.map((e) => [e.id, e]));
  const nameOf = (e) => `${e.firstName} ${e.lastName || ""}`.trim();

  const eligible = [];
  const failed = [];
  for (const id of ids) {
    const emp = byId.get(id);
    if (!emp) {
      failed.push({ id, reason: "Employee not found" });
      continue;
    }
    const name = nameOf(emp);
    const loginOn = emp.user?.isActive !== false;
    if (action === "DEACTIVATE") {
      if (emp.userId && emp.userId === actor.userId) {
        failed.push({ id, name, reason: "You cannot deactivate your own account" });
      } else if (ADMIN_ROLES.includes(emp.user?.role) && actor.role !== "SUPER_ADMIN") {
        failed.push({ id, name, reason: "Only a super admin can deactivate admin accounts" });
      } else if (!loginOn && emp.status === "INACTIVE") {
        failed.push({ id, name, reason: "Already deactivated" });
      } else {
        eligible.push(emp);
      }
    } else if (emp.status === "TERMINATED") {
      failed.push({ id, name, reason: "Terminated employees cannot be reactivated" });
    } else if (loginOn && emp.status !== "INACTIVE") {
      failed.push({ id, name, reason: "Already active" });
    } else {
      eligible.push(emp);
    }
  }

  let changed = eligible;
  if (eligible.length > 0) {
    changed = await prisma.$transaction(
      async (tx) => {
        let allowed = eligible;
        if (action === "ACTIVATE") {
          // Reactivated people take a seat again, so respect the plan limit.
          const { used, maxEmployees } = await assertSeatAvailable(organizationId, tx);
          const capacity = Math.max(0, maxEmployees - used);
          allowed = eligible.slice(0, capacity);
          eligible.slice(capacity).forEach((e) =>
            failed.push({ id: e.id, name: nameOf(e), reason: `Employee limit reached for your plan (${maxEmployees} seats)` }),
          );
          if (allowed.length === 0) return [];
        }

        const employeeIdList = allowed.map((e) => e.id);
        const userIdList = allowed.map((e) => e.userId).filter(Boolean);
        await tx.employee.updateMany({
          where: { id: { in: employeeIdList }, organizationId },
          data: { status: action === "DEACTIVATE" ? "INACTIVE" : "ACTIVE" },
        });
        if (userIdList.length > 0) {
          await tx.user.updateMany({
            where: { id: { in: userIdList }, organizationId },
            data: { isActive: action === "ACTIVATE" },
          });
        }
        return allowed;
      },
      { timeout: 20000, maxWait: 10000 },
    );
  }

  return {
    action,
    changedCount: changed.length,
    failedCount: failed.length,
    changed: changed.map((e) => ({ id: e.id, name: nameOf(e) })),
    failed,
  };
};

/**
 * 6. POST /api/employees/invite — Admin invites an employee by email.
 * Auto-creates User+Employee account, sends welcome email with temp credentials.
 */
const inviteEmployee = async (organizationId, invitedByUserId, data, actorRole = "COMPANY_ADMIN") => {
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
  const gender = normalizeGender(data.gender);

  const existing = await prisma.user.findUnique({
    where: { organizationId_email: { organizationId, email: cleanEmail } },
  });
  if (existing) throw new Error(`A user with email '${cleanEmail}' already exists in this organization.`);

  const org = await prisma.organization.findUnique({ where: { id: organizationId } });
  if (!org) throw new Error("Organization not found.");

  // Generate temp password: TMP-XXXXXX + 4 random digits
  const tempPassword = generateTempPassword();
  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(tempPassword, salt);

  // Determine employee code
  const employeeCode = data.employeeCode?.trim() || `EMP-${Date.now().toString().slice(-6)}`;
  const userRole = resolveAssignableRole(role, actorRole);
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
    await assertSeatAvailable(organizationId, tx);
    const user = await tx.user.create({
      data: {
        email: cleanEmail,
        passwordHash,
        role: userRole,
        organizationId,
        avatarUrl,
        mustChangePassword: true, // force password change on first login
        isActive: true,
        // Admin-invited, not self-registered — the admin already vouches for this address.
        emailVerifiedAt: new Date(),
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
        gender,
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
        companyLogoUrl: org.logoUrl,
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


/**
 * Bulk import employees from an array of records (Excel/CSV parsed rows).
 *
 * Work is batched: a fixed number of queries regardless of row count, one
 * transaction for all inserts, and concurrent password hashing. The previous
 * per-row version needed ~8 sequential round-trips per employee, so any real
 * spreadsheet outlived the HTTP proxy timeout and surfaced as a 500.
 */
const BULK_IMPORT_MAX_ROWS = 200;
const BULK_HASH_CONCURRENCY = 20;
const BULK_HASH_COST = 8;

const badRequest = (message) => {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
};

const bulkImportEmployees = async (organizationId, employeesList, actorRole = "COMPANY_ADMIN") => {
  if (!Array.isArray(employeesList) || employeesList.length === 0) {
    throw badRequest("No employee records provided for import");
  }
  if (employeesList.length > BULK_IMPORT_MAX_ROWS) {
    throw badRequest(`Bulk import is limited to ${BULK_IMPORT_MAX_ROWS} rows per request`);
  }

  const [org, branches, departments, shifts] = await Promise.all([
    prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true, logoUrl: true } }),
    prisma.branch.findMany({ where: { organizationId }, select: { id: true, name: true } }),
    prisma.department.findMany({ where: { organizationId }, select: { id: true, name: true } }),
    prisma.shift.findMany({ where: { organizationId }, select: { id: true, name: true } }),
  ]);

  const indexByIdAndName = (rows) => {
    const map = new Map();
    rows.forEach((r) => {
      map.set(r.id, r.id);
      map.set(String(r.name).toLowerCase().trim(), r.id);
    });
    return map;
  };
  const branchMap = indexByIdAndName(branches);
  const deptMap = indexByIdAndName(departments);
  const shiftMap = indexByIdAndName(shifts);
  const lookup = (map, raw, fallback) => (raw ? map.get(raw) || map.get(raw.toLowerCase()) || fallback : fallback);

  const text = (...values) => {
    for (const v of values) {
      if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
    }
    return "";
  };

  const tidyName = (v) => v.replace(/\s+/g, " ").trim();
  const keyOf = (v) => v.toLowerCase();

  // ── 1. Normalise and validate every row in memory ─────────────────────────
  const results = [];
  const parsed = [];
  employeesList.forEach((raw, i) => {
    const row = i + 1;
    const record = raw && typeof raw === "object" ? raw : {};
    const firstName = text(record.firstName, record.name, record["First Name"]);
    const lastName = text(record.lastName, record["Last Name"]) || null;
    const email = text(record.email, record["Email"], record["Work Email"]).toLowerCase();

    if (!firstName) {
      results.push({ row, email: email || "N/A", status: "FAILED", reason: "First name is required" });
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      results.push({ row, email: email || "N/A", status: "FAILED", reason: "Valid email address is required" });
      return;
    }

    const rawRole = text(record.role, record["Role"], "EMPLOYEE").toUpperCase();
    parsed.push({
      row,
      firstName,
      lastName,
      email,
      phone: text(record.phone, record["Phone"], record["Mobile"]) || null,
      designation: text(record.designation, record["Designation"], record["Title"]) || null,
      rawCode: text(record.employeeCode, record.code, record["Employee Code"], record["Code"]),
      rawRole,
      rawDept: tidyName(text(record.department, record.departmentId, record["Department"])),
      rawBranch: tidyName(text(record.branch, record.branchId, record["Branch"])),
      rawShift: text(record.shift, record.shiftId, record["Shift"]),
      password: text(record.password),
    });
  });

  // ── 2. Two lookups cover every duplicate check ────────────────────────────
  const [existingUsers, existingCodes] = await Promise.all([
    prisma.user.findMany({
      where: { organizationId, email: { in: parsed.map((r) => r.email) } },
      select: { email: true },
    }),
    prisma.employee.findMany({
      where: { organizationId, employeeCode: { in: parsed.map((r) => r.rawCode).filter(Boolean) } },
      select: { employeeCode: true },
    }),
  ]);
  const takenEmails = new Set(existingUsers.map((u) => u.email.toLowerCase()));
  const takenCodes = new Set(existingCodes.map((e) => e.employeeCode));

  const stamp = Date.now().toString().slice(-5);
  const accepted = [];
  for (const r of parsed) {
    if (takenEmails.has(r.email)) {
      results.push({
        row: r.row,
        email: r.email,
        status: "FAILED",
        reason: "Email already registered in this workspace",
      });
      continue;
    }
    takenEmails.add(r.email); // also catches duplicate rows inside the file

    let employeeCode = r.rawCode || `EMP-${stamp}${r.row}`;
    if (takenCodes.has(employeeCode)) employeeCode = `EMP-${stamp}${r.row}`;
    takenCodes.add(employeeCode);

    try {
      r.userRole = resolveAssignableRole(r.rawRole === "MANAGER" ? "MANAGER" : "EMPLOYEE", actorRole);
    } catch (err) {
      results.push({ row: r.row, email: r.email, status: "FAILED", reason: err.message });
      continue;
    }
    r.employeeCode = employeeCode;
    // A name that matches an existing record links to it. A name that does not
    // is created during the import. Only a blank cell uses the workspace default.
    r.branchId = r.rawBranch ? branchMap.get(r.rawBranch) || branchMap.get(keyOf(r.rawBranch)) || null : branches[0]?.id || null;
    r.departmentId = r.rawDept ? deptMap.get(r.rawDept) || deptMap.get(keyOf(r.rawDept)) || null : departments[0]?.id || null;
    if (r.rawBranch && !r.branchId) r.newBranch = r.rawBranch;
    if (r.rawDept && !r.departmentId) r.newDepartment = r.rawDept;
    r.shiftId = lookup(shiftMap, r.rawShift, shifts[0]?.id || null);
    r.tempPassword = r.password || generateTempPassword();
    accepted.push(r);
  }

  // ── 3. Hash passwords concurrently, in bounded chunks ─────────────────────
  // bcryptjs is pure JS (~90ms/hash at cost 10). These are one-time temporary
  // passwords that must be changed at first login, so cost 8 keeps a full
  // batch well inside the HTTP timeout.
  for (let i = 0; i < accepted.length; i += BULK_HASH_CONCURRENCY) {
    const chunk = accepted.slice(i, i + BULK_HASH_CONCURRENCY);
    const hashes = await Promise.all(chunk.map((r) => bcrypt.hash(r.tempPassword, BULK_HASH_COST)));
    chunk.forEach((r, j) => {
      r.passwordHash = hashes[j];
    });
  }

  // ── 4. One transaction: seat check, then two bulk inserts ─────────────────
  let toInsert = accepted;
  const created = { departments: [], branches: [] };
  const warnings = [];
  const distinctNames = (names) => {
    const seen = new Map();
    names.filter(Boolean).forEach((n) => seen.has(keyOf(n)) || seen.set(keyOf(n), n));
    return seen;
  };
  if (accepted.length > 0) {
    try {
      toInsert = await prisma.$transaction(
        async (tx) => {
          const { used, maxEmployees } = await assertSeatAvailable(organizationId, tx);
          const capacity = Math.max(0, maxEmployees - used);
          const allowed = accepted.slice(0, capacity);
          accepted.slice(capacity).forEach((r) =>
            results.push({
              row: r.row,
              email: r.email,
              status: "FAILED",
              reason: `Employee limit reached for your plan (${maxEmployees} seats)`,
            }),
          );
          if (allowed.length === 0) return [];

          // Departments: create every name the file mentions that does not exist yet.
          const newDepartments = distinctNames(allowed.map((r) => r.newDepartment));
          if (newDepartments.size > 0) {
            const names = [...newDepartments.values()];
            await tx.department.createMany({
              data: names.map((name) => ({ organizationId, name })),
              skipDuplicates: true,
            });
            const rows = await tx.department.findMany({
              where: { organizationId, name: { in: names } },
              select: { id: true, name: true },
            });
            rows.forEach((d) => deptMap.set(keyOf(d.name), d.id));
            created.departments = names;
          }

          // Branches: same, but bounded by the plan's branch limit.
          const newBranches = distinctNames(allowed.map((r) => r.newBranch));
          if (newBranches.size > 0) {
            let room = 0;
            try {
              const { used, maxBranches } = await assertBranchAvailable(organizationId, tx);
              room = Math.max(0, maxBranches - used);
            } catch (err) {
              if (err.statusCode !== 403) throw err; // 403 = plan branch limit reached
            }
            const names = [...newBranches.values()].slice(0, room);
            if (names.length > 0) {
              await tx.branch.createMany({
                data: names.map((name) => ({ organizationId, name })),
                skipDuplicates: true,
              });
              const rows = await tx.branch.findMany({
                where: { organizationId, name: { in: names } },
                select: { id: true, name: true },
              });
              rows.forEach((b) => branchMap.set(keyOf(b.name), b.id));
              created.branches = names;
            }
            const skipped = [...newBranches.values()].slice(room);
            if (skipped.length > 0) {
              warnings.push(
                `Branch limit reached for your plan. These branches were not created and their employees use the default branch: ${skipped.join(", ")}`,
              );
            }
          }
          allowed.forEach((r) => {
            if (r.newDepartment) r.departmentId = deptMap.get(keyOf(r.newDepartment)) || null;
            if (r.newBranch) r.branchId = branchMap.get(keyOf(r.newBranch)) || branches[0]?.id || null;
          });

          const users = await tx.user.createManyAndReturn({
            data: allowed.map((r) => ({
              email: r.email,
              passwordHash: r.passwordHash,
              role: r.userRole,
              organizationId,
              avatarUrl: resolveAvatarUrl({
                firstName: r.firstName,
                lastName: r.lastName,
                employeeCode: r.employeeCode,
              }),
              mustChangePassword: true,
              isActive: true,
              // Admin-imported, not self-registered — the admin already vouches for this address.
              emailVerifiedAt: new Date(),
            })),
            select: { id: true, email: true, avatarUrl: true },
          });
          const userByEmail = new Map(users.map((u) => [u.email, u]));

          await tx.employee.createMany({
            data: allowed.map((r) => ({
              organizationId,
              userId: userByEmail.get(r.email).id,
              employeeCode: r.employeeCode,
              firstName: r.firstName,
              lastName: r.lastName,
              phone: r.phone,
              avatarUrl: userByEmail.get(r.email).avatarUrl,
              status: "ACTIVE",
              branchId: r.branchId,
              departmentId: r.departmentId,
              shiftId: r.shiftId,
              designation: r.designation,
              workEmail: r.email,
            })),
          });
          return allowed;
        },
        { timeout: 30000, maxWait: 10000 },
      );
    } catch (err) {
      if (err.code === "P2002") {
        const conflict = new Error("Some records were created by another request at the same time. Please retry the import.");
        conflict.statusCode = 409;
        throw conflict;
      }
      throw err;
    }
  }

  toInsert.forEach((r) =>
    results.push({
      row: r.row,
      name: `${r.firstName} ${r.lastName || ""}`.trim(),
      email: r.email,
      employeeCode: r.employeeCode,
      status: "SUCCESS",
    }),
  );
  results.sort((a, b) => a.row - b.row);

  // ── 5. Welcome emails go out after commit, one at a time, off the request ─
  const loginUrl = `${process.env.FRONTEND_URL || "http://localhost:3000"}/login`;
  void (async () => {
    for (const r of toInsert) {
      try {
        await emailService.sendEmployeeWelcomeEmail(r.email, r.firstName, {
          organizationName: org?.name || "WorkPulse",
          companyLogoUrl: org?.logoUrl,
          tempPassword: r.tempPassword,
          loginUrl,
          role: r.userRole,
        });
      } catch (err) {
        console.warn("[BulkImport] Welcome email failed:", err.message);
      }
    }
  })();

  const imported = results.filter((r) => r.status === "SUCCESS");
  const failed = results.filter((r) => r.status === "FAILED");

  return {
    success: true,
    message:
      `Processed ${employeesList.length} employees: ${imported.length} imported, ${failed.length} skipped.` +
      (created.departments.length ? ` Created ${created.departments.length} department(s).` : "") +
      (created.branches.length ? ` Created ${created.branches.length} branch(es).` : ""),
    createdDepartments: created.departments,
    createdBranches: created.branches,
    warnings,
    importedCount: imported.length,
    failedCount: failed.length,
    total: employeesList.length,
    imported,
    failed,
    results,
    // The UI reads the summary from `data`; keep the flat fields for API clients.
    data: {
      importedCount: imported.length,
      failedCount: failed.length,
      imported,
      failed,
      createdDepartments: created.departments,
      createdBranches: created.branches,
      warnings,
    },
  };
};

module.exports = {
  bulkImportEmployees,
  setEmployeesAccess,
  createEmployee,
  getEmployees,
  getEmployeeById,
  updateEmployee,
  deleteEmployee,
  inviteEmployee,
  getMyEmployee,
  updateMyProfile,
};
