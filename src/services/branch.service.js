const { assertBranchAvailable } = require("./entitlement.service");
const prisma = require("../config/database");
const { parseCoordinates, parseRadius } = require("../utils/branchValidation");

/**
 * 1. POST /api/branches - Create Branch
 */
const createBranch = async (organizationId, data) => {
  const { name, address, latitude, longitude, radiusMeters } = data;

  if (!name || !name.trim()) {
    throw new Error("Branch name is required");
  }

  const coordinates = parseCoordinates(latitude, longitude);
  const radius = parseRadius(radiusMeters);

  return prisma.$transaction(async (tx) => {
    await assertBranchAvailable(organizationId, tx);
    return tx.branch.create({
      data: {
        organizationId,
        name: name.trim(),
        address: address ? address.trim() : null,
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
        radiusMeters: radius,
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
  // Validate the values the branch will end up with, so changing one coordinate cannot leave a half-set location.
  const coordinates = parseCoordinates(
    latitude !== undefined ? latitude : branch.latitude,
    longitude !== undefined ? longitude : branch.longitude,
  );
  const radius = radiusMeters !== undefined ? parseRadius(radiusMeters) : undefined;

  return await prisma.branch.update({
    where: { id: branchId },
    data: {
      ...(name ? { name: name.trim() } : {}),
      ...(address !== undefined ? { address: address ? address.trim() : null } : {}),
      ...(latitude !== undefined || longitude !== undefined ? { latitude: coordinates.latitude, longitude: coordinates.longitude } : {}),
      ...(radius !== undefined ? { radiusMeters: radius } : {}),
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

  // Removing a branch would drop everyone assigned to it out of their geofence, so check-in would
  // quietly stop being location-checked. Require an explicit reassignment first.
  const assigned = await prisma.employee.count({ where: { branchId, organizationId } });
  if (assigned > 0) {
    const error = new Error(`${assigned} employee${assigned === 1 ? "" : "s"} ${assigned === 1 ? "is" : "are"} still assigned to this branch. Move them to another branch before deleting it.`);
    error.statusCode = 409;
    throw error;
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
