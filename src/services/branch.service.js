const prisma = require("../config/database");

/**
 * 1. POST /api/branches - Create Branch
 */
const createBranch = async (organizationId, data) => {
  const { name, address, latitude, longitude, radiusMeters } = data;

  if (!name || !name.trim()) {
    throw new Error("Branch name is required");
  }

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${organizationId}))`;
    const org = await tx.organization.findUnique({ where: { id: organizationId }, include: { subscription: true } });
    const plan = require("./entitlement.service").assertEntitled(org);
    const count = await tx.branch.count({ where: { organizationId } });
    if (count >= plan.maxBranches) throw Object.assign(new Error("Branch limit reached for this plan"), { statusCode: 402 });
  return await tx.branch.create({
    data: {
      organizationId,
      name: name.trim(),
      address: address ? address.trim() : null,
      latitude: latitude !== undefined && latitude !== null && latitude !== '' ? parseFloat(latitude) : null,
      longitude: longitude !== undefined && longitude !== null && longitude !== '' ? parseFloat(longitude) : null,
      radiusMeters: radiusMeters ? parseInt(radiusMeters, 10) : 200,
    },
    include: {
      _count: {
        select: { employees: true },
      },
    },
  });
  });
};

/**
 * 2. GET /api/branches - List Branches
 */
const getBranches = async (organizationId) => {
  return await prisma.branch.findMany({
    where: { organizationId },
    include: {
      _count: {
        select: { employees: true, attendances: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });
};

/**
 * 3. GET /api/branches/:id - Get Branch by ID
 */
const getBranchById = async (organizationId, branchId) => {
  const branch = await prisma.branch.findFirst({
    where: { id: branchId, organizationId },
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
        select: { employees: true, attendances: true },
      },
    },
  });

  if (!branch) {
    throw new Error("Branch not found in this organization");
  }

  return branch;
};

/**
 * 4. PUT /api/branches/:id - Update Branch
 */
const updateBranch = async (organizationId, branchId, data) => {
  const branch = await prisma.branch.findFirst({
    where: { id: branchId, organizationId },
  });

  if (!branch) {
    throw new Error("Branch not found in this organization");
  }

  const { name, address, latitude, longitude, radiusMeters } = data;

  return await prisma.branch.update({
    where: { id: branchId },
    data: {
      ...(name ? { name: name.trim() } : {}),
      ...(address !== undefined ? { address: address ? address.trim() : null } : {}),
      ...(latitude !== undefined ? { latitude: latitude !== null && latitude !== '' ? parseFloat(latitude) : null } : {}),
      ...(longitude !== undefined ? { longitude: longitude !== null && longitude !== '' ? parseFloat(longitude) : null } : {}),
      ...(radiusMeters !== undefined ? { radiusMeters: parseInt(radiusMeters, 10) } : {}),
    },
    include: {
      _count: {
        select: { employees: true },
      },
    },
  });
};

/**
 * 5. DELETE /api/branches/:id - Delete Branch
 */
const deleteBranch = async (organizationId, branchId) => {
  const branch = await prisma.branch.findFirst({
    where: { id: branchId, organizationId },
  });

  if (!branch) {
    throw new Error("Branch not found in this organization");
  }

  return await prisma.$transaction(async (tx) => {
    // Unassign branch from employees before deleting
    await tx.employee.updateMany({
      where: { branchId },
      data: { branchId: null },
    });

    // Unassign branch from attendance records if any
    await tx.attendance.updateMany({
      where: { branchId },
      data: { branchId: null },
    });

    await tx.branch.delete({
      where: { id: branchId },
    });

    return { success: true };
  });
};

module.exports = {
  createBranch,
  getBranches,
  getBranchById,
  updateBranch,
  deleteBranch,
};
