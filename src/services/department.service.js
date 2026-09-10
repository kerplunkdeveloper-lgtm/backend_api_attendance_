const prisma = require("../config/database");

/**
 * 1. POST /api/departments - Create Department
 */
const createDepartment = async (organizationId, name) => {
  if (!name || !name.trim()) {
    throw new Error("Department name is required");
  }

  const existing = await prisma.department.findUnique({
    where: {
      organizationId_name: {
        organizationId,
        name: name.trim(),
      },
    },
  });

  if (existing) {
    throw new Error(`Department '${name.trim()}' already exists in this organization`);
  }

  return await prisma.department.create({
    data: {
      organizationId,
      name: name.trim(),
    },
    include: {
      _count: {
        select: { employees: true },
      },
    },
  });
};

/**
 * 2. GET /api/departments - List Departments
 */
const getDepartments = async (organizationId) => {
  return await prisma.department.findMany({
    where: { organizationId },
    include: {
      _count: {
        select: { employees: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });
};

/**
 * 3. GET /api/departments/:id - Get Department by ID
 */
const getDepartmentById = async (organizationId, departmentId) => {
  const department = await prisma.department.findFirst({
    where: { id: departmentId, organizationId },
    include: {
      employees: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          employeeCode: true,
          status: true,
        },
      },
      _count: {
        select: { employees: true },
      },
    },
  });

  if (!department) {
    throw new Error("Department not found in this organization");
  }

  return department;
};

/**
 * 4. PUT /api/departments/:id - Update Department
 */
const updateDepartment = async (organizationId, departmentId, name) => {
  if (!name || !name.trim()) {
    throw new Error("Department name is required");
  }

  const department = await prisma.department.findFirst({
    where: { id: departmentId, organizationId },
  });

  if (!department) {
    throw new Error("Department not found in this organization");
  }

  const existing = await prisma.department.findUnique({
    where: {
      organizationId_name: {
        organizationId,
        name: name.trim(),
      },
    },
  });

  if (existing && existing.id !== departmentId) {
    throw new Error(`Another department with name '${name.trim()}' already exists`);
  }

  return await prisma.department.update({
    where: { id: departmentId },
    data: { name: name.trim() },
    include: {
      _count: {
        select: { employees: true },
      },
    },
  });
};

/**
 * 5. DELETE /api/departments/:id - Delete Department
 */
const deleteDepartment = async (organizationId, departmentId) => {
  const department = await prisma.department.findFirst({
    where: { id: departmentId, organizationId },
  });

  if (!department) {
    throw new Error("Department not found in this organization");
  }

  return await prisma.$transaction(async (tx) => {
    // Unassign department from employees before deleting
    await tx.employee.updateMany({
      where: { departmentId },
      data: { departmentId: null },
    });

    await tx.department.delete({
      where: { id: departmentId },
    });

    return { success: true };
  });
};

module.exports = {
  createDepartment,
  getDepartments,
  getDepartmentById,
  updateDepartment,
  deleteDepartment,
};
