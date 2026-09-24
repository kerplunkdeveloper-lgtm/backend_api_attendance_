const prisma = require("../config/database");
const notificationService = require("./notification.service");

const CATEGORY_PREFIXES = {
  LAPTOP: "LAP",
  DESKTOP: "DSK",
  MONITOR: "MON",
  MOBILE_PHONE: "MOB",
  TABLET: "TAB",
  HEADPHONES_PERIPHERALS: "PER",
  SECURITY_TOKEN_KEY: "SEC",
  OFFICE_FURNITURE: "FUR",
  VEHICLE: "VEH",
  OTHER: "AST",
};

const ASSET_CATEGORIES = [
  { id: "LAPTOP", name: "Laptop", prefix: "LAP" },
  { id: "DESKTOP", name: "Desktop Computer", prefix: "DSK" },
  { id: "MONITOR", name: "External Monitor", prefix: "MON" },
  { id: "MOBILE_PHONE", name: "Mobile Phone", prefix: "MOB" },
  { id: "TABLET", name: "Tablet", prefix: "TAB" },
  { id: "HEADPHONES_PERIPHERALS", name: "Headphones & Peripherals", prefix: "PER" },
  { id: "SECURITY_TOKEN_KEY", name: "Security Token / YubiKey", prefix: "SEC" },
  { id: "OFFICE_FURNITURE", name: "Office Furniture", prefix: "FUR" },
  { id: "VEHICLE", name: "Company Vehicle", prefix: "VEH" },
  { id: "OTHER", name: "Other Equipment", prefix: "AST" },
];

class AssetService {
  /**
   * Helper: Generate unique asset code like LAP-00101
   */
  async generateAssetCode(organizationId, category = "LAPTOP") {
    const prefix = CATEGORY_PREFIXES[category] || "AST";
    const count = await prisma.asset.count({
      where: { organizationId, category },
    });
    const nextNumber = count + 101;
    let code = `${prefix}-${String(nextNumber).padStart(5, "0")}`;
    
    // Check if code exists, if so increment until unique
    let existing = await prisma.asset.findUnique({
      where: {
        organizationId_assetCode: { organizationId, assetCode: code },
      },
    });

    let counter = nextNumber;
    while (existing) {
      counter++;
      code = `${prefix}-${String(counter).padStart(5, "0")}`;
      existing = await prisma.asset.findUnique({
        where: {
          organizationId_assetCode: { organizationId, assetCode: code },
        },
      });
    }

    return code;
  }

  /**
   * 1. Get Assets List with Filters & Metrics
   */
  async getAssets(organizationId, filters = {}) {
    const { category, status, condition, assignedToId, search } = filters;
    const where = { organizationId };

    if (category && category !== "ALL") {
      where.category = category;
    }

    if (status && status !== "ALL") {
      where.status = status;
    }

    if (condition && condition !== "ALL") {
      where.condition = condition;
    }

    if (assignedToId) {
      where.assignedToId = assignedToId;
    }

    if (search) {
      where.OR = [
        { assetCode: { contains: search, mode: "insensitive" } },
        { name: { contains: search, mode: "insensitive" } },
        { brand: { contains: search, mode: "insensitive" } },
        { modelNumber: { contains: search, mode: "insensitive" } },
        { serialNumber: { contains: search, mode: "insensitive" } },
        {
          assignedTo: {
            OR: [
              { firstName: { contains: search, mode: "insensitive" } },
              { lastName: { contains: search, mode: "insensitive" } },
              { employeeCode: { contains: search, mode: "insensitive" } },
            ],
          },
        },
      ];
    }

    const assets = await prisma.asset.findMany({
      where,
      include: {
        assignedTo: {
          select: {
            id: true,
            employeeCode: true,
            firstName: true,
            lastName: true,
            department: { select: { name: true } },
            user: { select: { email: true } },
          },
        },
        _count: {
          select: {
            assignments: true,
            maintenances: true,
          },
        },
      },
      orderBy: [{ updatedAt: "desc" }],
    });

    // Compute overview stats for the organization
    const allOrgAssets = await prisma.asset.findMany({
      where: { organizationId },
      select: {
        status: true,
        purchaseCost: true,
      },
    });

    let totalAssetValue = 0;
    let assignedCount = 0;
    let availableCount = 0;
    let underMaintenanceCount = 0;
    let damagedCount = 0;
    let retiredCount = 0;

    for (const a of allOrgAssets) {
      if (a.purchaseCost) totalAssetValue += Number(a.purchaseCost);
      if (a.status === "ASSIGNED") assignedCount++;
      else if (a.status === "AVAILABLE") availableCount++;
      else if (a.status === "UNDER_MAINTENANCE") underMaintenanceCount++;
      else if (a.status === "DAMAGED") damagedCount++;
      else if (a.status === "RETIRED") retiredCount++;
    }

    return {
      assets,
      metrics: {
        totalAssets: allOrgAssets.length,
        assignedCount,
        availableCount,
        underMaintenanceCount,
        damagedCount,
        retiredCount,
        totalAssetValue: Math.round(totalAssetValue * 100) / 100,
      },
      categories: ASSET_CATEGORIES,
    };
  }

  /**
   * 2. Get Single Asset with Full Lifecycle History
   */
  async getAssetById(organizationId, assetId) {
    const asset = await prisma.asset.findFirst({
      where: { id: assetId, organizationId },
      include: {
        assignedTo: {
          select: {
            id: true,
            employeeCode: true,
            firstName: true,
            lastName: true,
            phone: true,
            department: { select: { name: true } },
            user: { select: { email: true } },
          },
        },
        assignments: {
          include: {
            employee: {
              select: {
                id: true,
                employeeCode: true,
                firstName: true,
                lastName: true,
                department: { select: { name: true } },
              },
            },
          },
          orderBy: { createdAt: "desc" },
        },
        maintenances: {
          orderBy: { startDate: "desc" },
        },
      },
    });

    if (!asset) {
      const error = new Error("Asset not found");
      error.statusCode = 404;
      throw error;
    }

    return asset;
  }

  /**
   * 3. Create Asset
   */
  async createAsset(organizationId, payload, createdByUser) {
    const {
      name,
      category = "LAPTOP",
      brand,
      modelNumber,
      serialNumber,
      purchaseDate,
      purchaseCost,
      warrantyExpiry,
      condition = "NEW",
      specifications,
      notes,
      assignedToId,
    } = payload;

    if (!name) {
      const error = new Error("Asset name is required");
      error.statusCode = 400;
      throw error;
    }

    let assetCode = payload.assetCode?.trim();
    if (!assetCode) {
      assetCode = await this.generateAssetCode(organizationId, category);
    } else {
      // Check uniqueness
      const existing = await prisma.asset.findUnique({
        where: {
          organizationId_assetCode: { organizationId, assetCode },
        },
      });
      if (existing) {
        const error = new Error(`Asset code '${assetCode}' already exists in your organization`);
        error.statusCode = 400;
        throw error;
      }
    }

    let status = "AVAILABLE";
    let assignedDate = null;
    let assignedCondition = null;

    if (assignedToId) {
      const emp = await prisma.employee.findFirst({
        where: { id: assignedToId, organizationId },
      });
      if (!emp) {
        const error = new Error("Assigned employee not found");
        error.statusCode = 404;
        throw error;
      }
      status = "ASSIGNED";
      assignedDate = new Date();
      assignedCondition = condition;
    }

    const asset = await prisma.asset.create({
      data: {
        organizationId,
        assetCode,
        name,
        category,
        brand: brand ? brand.trim() : null,
        modelNumber: modelNumber ? modelNumber.trim() : null,
        serialNumber: serialNumber ? serialNumber.trim() : null,
        purchaseDate: purchaseDate ? new Date(purchaseDate) : null,
        purchaseCost: purchaseCost ? Number(purchaseCost) : null,
        warrantyExpiry: warrantyExpiry ? new Date(warrantyExpiry) : null,
        status,
        condition,
        specifications: specifications || null,
        notes: notes ? notes.trim() : null,
        assignedToId: assignedToId || null,
        assignedDate,
        assignedCondition,
      },
    });

    // If assigned at creation, create initial assignment record
    if (assignedToId) {
      await prisma.assetAssignment.create({
        data: {
          organizationId,
          assetId: asset.id,
          employeeId: assignedToId,
          type: "ASSIGNMENT",
          assignedDate: new Date(),
          conditionOnAssign: condition,
          assignedBy: createdByUser?.email || "Admin",
          remarks: "Initial assignment during asset creation",
        },
      });

      const emp = await prisma.employee.findUnique({
        where: { id: assignedToId },
        include: { user: true },
      });

      if (emp?.user?.id) {
        await notificationService.createNotification({
          organizationId,
          userId: emp.user.id,
          title: "New Asset Assigned",
          message: `Asset ${asset.assetCode} (${asset.name}) has been assigned to you.`,
          type: "SYSTEM",
        });
      }
    }

    return asset;
  }

  /**
   * 4. Update Asset Details
   */
  async updateAsset(organizationId, assetId, payload) {
    const asset = await prisma.asset.findFirst({
      where: { id: assetId, organizationId },
    });

    if (!asset) {
      const error = new Error("Asset not found");
      error.statusCode = 404;
      throw error;
    }

    const {
      name,
      category,
      brand,
      modelNumber,
      serialNumber,
      purchaseDate,
      purchaseCost,
      warrantyExpiry,
      condition,
      status,
      specifications,
      notes,
    } = payload;

    const updated = await prisma.asset.update({
      where: { id: assetId },
      data: {
        name: name !== undefined ? name : asset.name,
        category: category !== undefined ? category : asset.category,
        brand: brand !== undefined ? brand : asset.brand,
        modelNumber: modelNumber !== undefined ? modelNumber : asset.modelNumber,
        serialNumber: serialNumber !== undefined ? serialNumber : asset.serialNumber,
        purchaseDate: purchaseDate !== undefined ? (purchaseDate ? new Date(purchaseDate) : null) : asset.purchaseDate,
        purchaseCost: purchaseCost !== undefined ? (purchaseCost ? Number(purchaseCost) : null) : asset.purchaseCost,
        warrantyExpiry: warrantyExpiry !== undefined ? (warrantyExpiry ? new Date(warrantyExpiry) : null) : asset.warrantyExpiry,
        condition: condition !== undefined ? condition : asset.condition,
        status: status !== undefined ? status : asset.status,
        specifications: specifications !== undefined ? specifications : asset.specifications,
        notes: notes !== undefined ? notes : asset.notes,
      },
      include: {
        assignedTo: {
          select: {
            id: true,
            employeeCode: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    return updated;
  }

  /**
   * 5. Delete Asset
   */
  async deleteAsset(organizationId, assetId) {
    const asset = await prisma.asset.findFirst({
      where: { id: assetId, organizationId },
    });

    if (!asset) {
      const error = new Error("Asset not found");
      error.statusCode = 404;
      throw error;
    }

    if (asset.status === "ASSIGNED") {
      const error = new Error("Cannot delete an asset currently assigned to an employee. Please return the asset first.");
      error.statusCode = 400;
      throw error;
    }

    await prisma.asset.delete({
      where: { id: assetId },
    });

    return { message: "Asset deleted successfully", assetId };
  }

  /**
   * 6. Assign Asset to Employee
   */
  async assignAsset(organizationId, assetId, payload, assignedByUser) {
    const { employeeId, conditionOnAssign, remarks } = payload;

    if (!employeeId) {
      const error = new Error("employeeId is required");
      error.statusCode = 400;
      throw error;
    }

    const asset = await prisma.asset.findFirst({
      where: { id: assetId, organizationId },
    });

    if (!asset) {
      const error = new Error("Asset not found");
      error.statusCode = 404;
      throw error;
    }

    const employee = await prisma.employee.findFirst({
      where: { id: employeeId, organizationId },
      include: { user: true },
    });

    if (!employee) {
      const error = new Error("Employee not found");
      error.statusCode = 404;
      throw error;
    }

    const cond = conditionOnAssign || asset.condition;

    // Update asset
    const updatedAsset = await prisma.asset.update({
      where: { id: assetId },
      data: {
        status: "ASSIGNED",
        assignedToId: employeeId,
        assignedDate: new Date(),
        assignedCondition: cond,
        condition: cond,
      },
      include: {
        assignedTo: {
          select: {
            id: true,
            employeeCode: true,
            firstName: true,
            lastName: true,
            department: { select: { name: true } },
          },
        },
      },
    });

    // Record custody transition
    await prisma.assetAssignment.create({
      data: {
        organizationId,
        assetId,
        employeeId,
        type: "ASSIGNMENT",
        assignedDate: new Date(),
        conditionOnAssign: cond,
        assignedBy: assignedByUser?.email || "Admin",
        remarks: remarks ? remarks.trim() : null,
      },
    });

    // Notify employee
    if (employee.user?.id) {
      await notificationService.createNotification({
        organizationId,
        userId: employee.user.id,
        title: "Asset Assigned",
        message: `Asset ${asset.assetCode} (${asset.name}) has been assigned to you. Condition: ${cond}.`,
        type: "SYSTEM",
      });
    }

    return updatedAsset;
  }

  /**
   * 7. Return Asset
   */
  async returnAsset(organizationId, assetId, payload, returnedToUser) {
    const {
      conditionOnReturn = "GOOD",
      recoveryCharge = 0,
      remarks,
    } = payload;

    const asset = await prisma.asset.findFirst({
      where: { id: assetId, organizationId },
      include: {
        assignedTo: {
          include: { user: true },
        },
      },
    });

    if (!asset) {
      const error = new Error("Asset not found");
      error.statusCode = 404;
      throw error;
    }

    if (!asset.assignedToId) {
      const error = new Error("Asset is not currently assigned to any employee");
      error.statusCode = 400;
      throw error;
    }

    const previousEmployee = asset.assignedTo;
    const previousEmployeeId = asset.assignedToId;

    // Status: if damaged or fair with issue
    let nextStatus = "AVAILABLE";
    if (conditionOnReturn === "DAMAGED") {
      nextStatus = "DAMAGED";
    }

    const updatedAsset = await prisma.asset.update({
      where: { id: assetId },
      data: {
        status: nextStatus,
        condition: conditionOnReturn,
        assignedToId: null,
        assignedDate: null,
        assignedCondition: null,
      },
    });

    // Record Return Assignment
    await prisma.assetAssignment.create({
      data: {
        organizationId,
        assetId,
        employeeId: previousEmployeeId,
        type: "RETURN",
        returnedDate: new Date(),
        conditionOnAssign: asset.assignedCondition || asset.condition,
        conditionOnReturn,
        returnedTo: returnedToUser?.email || "Admin",
        recoveryCharge: recoveryCharge ? Number(recoveryCharge) : null,
        remarks: remarks ? remarks.trim() : null,
      },
    });

    // Synergize with Offboarding: If employee has an active exit in NOTICE_PERIOD or CLEARANCE_IN_PROGRESS,
    // check if there is an IT_ASSETS clearance item.
    const activeExit = await prisma.employeeExit.findFirst({
      where: {
        employeeId: previousEmployeeId,
        organizationId,
        status: { in: ["NOTICE_PERIOD", "CLEARANCE_IN_PROGRESS"] },
      },
      include: {
        clearances: true,
      },
    });

    if (activeExit) {
      // Find remaining assigned assets for this employee
      const remainingAssetsCount = await prisma.asset.count({
        where: {
          organizationId,
          assignedToId: previousEmployeeId,
        },
      });

      const itClearance = activeExit.clearances.find(
        (c) => c.department === "IT_ASSETS" && c.itemName.includes("Laptop")
      );

      if (itClearance) {
        if (remainingAssetsCount === 0) {
          // All assets returned!
          await prisma.employeeClearance.update({
            where: { id: itClearance.id },
            data: {
              status: recoveryCharge > 0 ? "RECOVERABLE_DUE" : "CLEARED",
              clearedAt: new Date(),
              clearedBy: returnedToUser?.id || null,
              clearanceNotes: `All assets returned. ${asset.assetCode} returned in ${conditionOnReturn} condition.${recoveryCharge > 0 ? ` Damage recovery: ₹${recoveryCharge}` : ""}`,
              dueAmount: recoveryCharge > 0 ? Number(recoveryCharge) : 0,
            },
          });
        } else {
          // Partially returned
          await prisma.employeeClearance.update({
            where: { id: itClearance.id },
            data: {
              status: "IN_PROGRESS",
              clearanceNotes: `Asset ${asset.assetCode} returned. ${remainingAssetsCount} asset(s) still pending return.`,
              dueAmount: recoveryCharge > 0 ? Number(recoveryCharge) : Number(itClearance.dueAmount || 0),
            },
          });
        }
      }
    }

    // Notify employee
    if (previousEmployee?.user?.id) {
      await notificationService.createNotification({
        organizationId,
        userId: previousEmployee.user.id,
        title: "Asset Returned",
        message: `Asset ${asset.assetCode} (${asset.name}) has been returned successfully. Condition: ${conditionOnReturn}.${recoveryCharge > 0 ? ` Damage recovery charge: ₹${recoveryCharge}` : ""}`,
        type: "SYSTEM",
      });
    }

    return updatedAsset;
  }

  /**
   * 8. Transfer Asset Directly to Another Employee
   */
  async transferAsset(organizationId, assetId, payload, transferredByUser) {
    const { toEmployeeId, condition, remarks } = payload;

    if (!toEmployeeId) {
      const error = new Error("Target employee (toEmployeeId) is required");
      error.statusCode = 400;
      throw error;
    }

    const asset = await prisma.asset.findFirst({
      where: { id: assetId, organizationId },
      include: { assignedTo: { include: { user: true } } },
    });

    if (!asset) {
      const error = new Error("Asset not found");
      error.statusCode = 404;
      throw error;
    }

    const targetEmployee = await prisma.employee.findFirst({
      where: { id: toEmployeeId, organizationId },
      include: { user: true },
    });

    if (!targetEmployee) {
      const error = new Error("Target employee not found");
      error.statusCode = 404;
      throw error;
    }

    const fromEmployeeId = asset.assignedToId;
    const cond = condition || asset.condition;

    // Update asset
    const updatedAsset = await prisma.asset.update({
      where: { id: assetId },
      data: {
        status: "ASSIGNED",
        assignedToId: toEmployeeId,
        assignedDate: new Date(),
        assignedCondition: cond,
        condition: cond,
      },
      include: {
        assignedTo: {
          select: {
            id: true,
            employeeCode: true,
            firstName: true,
            lastName: true,
            department: { select: { name: true } },
          },
        },
      },
    });

    // Record Transfer
    await prisma.assetAssignment.create({
      data: {
        organizationId,
        assetId,
        employeeId: toEmployeeId,
        fromEmployeeId,
        type: "TRANSFER",
        assignedDate: new Date(),
        conditionOnAssign: cond,
        assignedBy: transferredByUser?.email || "Admin",
        remarks: remarks ? remarks.trim() : `Transferred from ${asset.assignedTo?.firstName || "previous employee"}`,
      },
    });

    // Notify both employees
    if (asset.assignedTo?.user?.id) {
      await notificationService.createNotification({
        organizationId,
        userId: asset.assignedTo.user.id,
        title: "Asset Transferred",
        message: `Asset ${asset.assetCode} (${asset.name}) has been transferred to ${targetEmployee.firstName} ${targetEmployee.lastName || ""}.`,
        type: "SYSTEM",
      });
    }

    if (targetEmployee.user?.id) {
      await notificationService.createNotification({
        organizationId,
        userId: targetEmployee.user.id,
        title: "Asset Transferred to You",
        message: `Asset ${asset.assetCode} (${asset.name}) has been transferred to you from ${asset.assignedTo?.firstName || "colleague"}.`,
        type: "SYSTEM",
      });
    }

    return updatedAsset;
  }

  /**
   * 9. Log Asset Maintenance
   */
  async logMaintenance(organizationId, assetId, payload) {
    const { issueDescription, vendorName, cost, startDate, notes } = payload;

    if (!issueDescription) {
      const error = new Error("issueDescription is required");
      error.statusCode = 400;
      throw error;
    }

    const asset = await prisma.asset.findFirst({
      where: { id: assetId, organizationId },
    });

    if (!asset) {
      const error = new Error("Asset not found");
      error.statusCode = 404;
      throw error;
    }

    const maintenance = await prisma.assetMaintenance.create({
      data: {
        organizationId,
        assetId,
        issueDescription: issueDescription.trim(),
        vendorName: vendorName ? vendorName.trim() : null,
        cost: cost ? Number(cost) : null,
        startDate: startDate ? new Date(startDate) : new Date(),
        status: "IN_PROGRESS",
        notes: notes ? notes.trim() : null,
      },
    });

    // Set asset status to UNDER_MAINTENANCE
    await prisma.asset.update({
      where: { id: assetId },
      data: { status: "UNDER_MAINTENANCE" },
    });

    return maintenance;
  }

  /**
   * 10. Complete Asset Maintenance
   */
  async completeMaintenance(organizationId, assetId, maintenanceId, payload) {
    const { completedDate, cost, newCondition, status = "COMPLETED", notes } = payload;

    const maintenance = await prisma.assetMaintenance.findFirst({
      where: { id: maintenanceId, assetId, organizationId },
    });

    if (!maintenance) {
      const error = new Error("Maintenance record not found");
      error.statusCode = 404;
      throw error;
    }

    const asset = await prisma.asset.findFirst({
      where: { id: assetId, organizationId },
    });

    const updatedMaintenance = await prisma.assetMaintenance.update({
      where: { id: maintenanceId },
      data: {
        completedDate: completedDate ? new Date(completedDate) : new Date(),
        cost: cost !== undefined ? (cost ? Number(cost) : null) : maintenance.cost,
        status,
        notes: notes !== undefined ? notes : maintenance.notes,
      },
    });

    // Restore asset status
    const nextStatus = asset.assignedToId ? "ASSIGNED" : "AVAILABLE";
    await prisma.asset.update({
      where: { id: assetId },
      data: {
        status: nextStatus,
        condition: newCondition || asset.condition,
      },
    });

    return updatedMaintenance;
  }

  /**
   * 11. Get Assets Assigned to an Employee
   */
  async getEmployeeAssets(organizationId, employeeId) {
    const assignedAssets = await prisma.asset.findMany({
      where: {
        organizationId,
        assignedToId: employeeId,
      },
      include: {
        maintenances: {
          orderBy: { startDate: "desc" },
          take: 3,
        },
      },
      orderBy: { assignedDate: "desc" },
    });

    const history = await prisma.assetAssignment.findMany({
      where: {
        organizationId,
        employeeId,
      },
      include: {
        asset: {
          select: {
            id: true,
            assetCode: true,
            name: true,
            category: true,
            brand: true,
            modelNumber: true,
            serialNumber: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return {
      assignedAssets,
      history,
    };
  }
}

module.exports = new AssetService();
