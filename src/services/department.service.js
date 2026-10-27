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
  const [departments, titleCounts] = await Promise.all([
    prisma.department.findMany({
      where: { organizationId },
      include: {
        _count: {
          select: { employees: true },
        },
        designations: { select: { id: true, name: true }, orderBy: { name: "asc" } },
      },
      orderBy: { createdAt: "desc" },
    }),
    // How many people hold each title, counted from the designation written on their profile.
    prisma.employee.groupBy({
      by: ["departmentId", "designation"],
      where: { organizationId, departmentId: { not: null }, designation: { not: null } },
      _count: { _all: true },
    }),
  ]);

  const held = new Map();
  for (const row of titleCounts) {
    const key = `${row.departmentId}|${String(row.designation).trim().toLowerCase()}`;
    held.set(key, (held.get(key) || 0) + row._count._all);
  }
  return departments.map((department) => ({
    ...department,
    designations: (department.designations || []).map((d) => ({
      ...d,
      employeeCount: held.get(`${department.id}|${d.name.toLowerCase()}`) || 0,
    })),
  }));
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

const MAX_DESIGNATION_LENGTH = 60;

const fail = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
};

const cleanDesignation = (value) => {
  const name = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!name) fail("Designation name is required");
  if (name.length > MAX_DESIGNATION_LENGTH) fail(`Designation must be ${MAX_DESIGNATION_LENGTH} characters or fewer`);
  return name;
};

// A title is unique within its department regardless of capital letters ("editor" and "Editor" are the same).
const titleTaken = async (departmentId, name, exceptId) => {
  const titles = await prisma.designation.findMany({ where: { departmentId }, select: { id: true, name: true } });
  return titles.some((t) => t.id !== exceptId && t.name.toLowerCase() === name.toLowerCase());
};

/**
 * 6. POST /api/departments/:id/designations - Add a designation to a department
 */
const createDesignation = async (organizationId, departmentId, rawName) => {
  const name = cleanDesignation(rawName);
  const department = await prisma.department.findFirst({ where: { id: departmentId, organizationId }, select: { id: true, name: true } });
  if (!department) fail("Department not found in this organization", 404);
  if (await titleTaken(departmentId, name)) fail(`'${name}' already exists in ${department.name}`, 409);
  return prisma.designation.create({ data: { organizationId, departmentId, name }, select: { id: true, name: true, departmentId: true } });
};

/**
 * 7. PUT /api/departments/designations/:designationId - Rename a designation.
 * People who hold the old title are moved to the new one, so profiles and the list stay in step.
 */
const updateDesignation = async (organizationId, designationId, rawName) => {
  const name = cleanDesignation(rawName);
  const current = await prisma.designation.findFirst({ where: { id: designationId, organizationId } });
  if (!current) fail("Designation not found", 404);
  if (await titleTaken(current.departmentId, name, designationId)) fail(`'${name}' already exists in this department`, 409);

  return prisma.$transaction(async (tx) => {
    const updated = await tx.designation.update({ where: { id: designationId }, data: { name }, select: { id: true, name: true, departmentId: true } });
    if (current.name !== name) {
      await tx.employee.updateMany({
        where: { organizationId, departmentId: current.departmentId, designation: { equals: current.name, mode: "insensitive" } },
        data: { designation: name },
      });
    }
    return updated;
  });
};

/**
 * 8. DELETE /api/departments/designations/:designationId - Remove a designation from the list.
 * Employees keep the title written on their profile.
 */
const deleteDesignation = async (organizationId, designationId) => {
  const current = await prisma.designation.findFirst({ where: { id: designationId, organizationId }, select: { id: true } });
  if (!current) fail("Designation not found", 404);
  await prisma.designation.delete({ where: { id: designationId } });
  return { success: true };
};

module.exports = {
  createDesignation,
  updateDesignation,
  deleteDesignation,
  createDepartment,
  getDepartments,
  getDepartmentById,
  updateDepartment,
  deleteDepartment,
};
