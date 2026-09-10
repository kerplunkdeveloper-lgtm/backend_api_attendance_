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

  // Atomic creation of User + Employee
  return await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: cleanEmail,
        passwordHash,
        role,
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
      await tx.user.update({
        where: { id: employee.userId },
        data: { role },
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

module.exports = {
  createEmployee,
  getEmployees,
  getEmployeeById,
  updateEmployee,
  deleteEmployee,
};
