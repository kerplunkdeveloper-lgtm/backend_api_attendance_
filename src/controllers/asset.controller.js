const assetService = require("../services/asset.service");

class AssetController {
  /**
   * GET /api/assets
   * List all assets with search, category/status filters, and metrics
   */
  async getAssets(req, res, next) {
    try {
      const filters = {
        category: req.query.category,
        status: req.query.status,
        condition: req.query.condition,
        assignedToId: req.query.assignedToId,
        search: req.query.search,
      };

      const result = await assetService.getAssets(
        req.user.organizationId,
        filters,
      );
      return res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/assets/:id
   * Get single asset with assignment and maintenance history
   */
  async getAssetById(req, res, next) {
    try {
      const asset = await assetService.getAssetById(
        req.user.organizationId,
        req.params.id,
      );
      const isAdmin = ["SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"].includes(
        req.user.role,
      );
      if (!isAdmin) {
        const empId = req.user.employee?.id;
        const assignedToMe =
          asset.assignedToId === empId ||
          asset.currentAssignment?.employeeId === empId;
        if (!assignedToMe) {
          return res
            .status(403)
            .json({
              success: false,
              message: "You can only view assets assigned to you",
            });
        }
      }
      return res.json({
        success: true,
        data: asset,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/assets
   * Create asset (Admin / HR)
   */
  async createAsset(req, res, next) {
    try {
      const asset = await assetService.createAsset(
        req.user.organizationId,
        req.body,
        req.user,
      );
      return res.status(201).json({
        success: true,
        message: "Asset created successfully",
        data: asset,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /api/assets/:id
   * Update asset metadata
   */
  async updateAsset(req, res, next) {
    try {
      const asset = await assetService.updateAsset(
        req.user.organizationId,
        req.params.id,
        req.body,
      );
      return res.json({
        success: true,
        message: "Asset updated successfully",
        data: asset,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /api/assets/:id
   * Delete asset
   */
  async deleteAsset(req, res, next) {
    try {
      const result = await assetService.deleteAsset(
        req.user.organizationId,
        req.params.id,
      );
      return res.json({
        success: true,
        message: result.message,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/assets/:id/assign
   * Assign asset to employee
   */
  async assignAsset(req, res, next) {
    try {
      const asset = await assetService.assignAsset(
        req.user.organizationId,
        req.params.id,
        req.body,
        req.user,
      );
      return res.json({
        success: true,
        message: `Asset successfully assigned to ${asset.assignedTo?.firstName || "employee"}`,
        data: asset,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/assets/:id/return
   * Return asset to inventory
   */
  async returnAsset(req, res, next) {
    try {
      const asset = await assetService.returnAsset(
        req.user.organizationId,
        req.params.id,
        req.body,
        req.user,
      );
      return res.json({
        success: true,
        message: "Asset marked as returned to inventory",
        data: asset,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/assets/:id/transfer
   * Transfer asset to another employee
   */
  async transferAsset(req, res, next) {
    try {
      const asset = await assetService.transferAsset(
        req.user.organizationId,
        req.params.id,
        req.body,
        req.user,
      );
      return res.json({
        success: true,
        message: "Asset transferred successfully",
        data: asset,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/assets/:id/maintenance
   * Log maintenance for an asset
   */
  async logMaintenance(req, res, next) {
    try {
      const maintenance = await assetService.logMaintenance(
        req.user.organizationId,
        req.params.id,
        req.body,
      );
      return res.status(201).json({
        success: true,
        message: "Maintenance record created",
        data: maintenance,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /api/assets/:id/maintenance/:maintenanceId/complete
   * Complete maintenance
   */
  async completeMaintenance(req, res, next) {
    try {
      const maintenance = await assetService.completeMaintenance(
        req.user.organizationId,
        req.params.id,
        req.params.maintenanceId,
        req.body,
      );
      return res.json({
        success: true,
        message: "Maintenance marked as completed",
        data: maintenance,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/assets/my-assets
   * Logged-in employee's assigned assets
   */
  async getMyAssets(req, res, next) {
    try {
      if (!req.user.employee) {
        return res.status(404).json({
          success: false,
          message: "No employee record associated with current user",
        });
      }

      const result = await assetService.getEmployeeAssets(
        req.user.organizationId,
        req.user.employee.id,
      );

      return res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/assets/employee/:employeeId
   * Admin/HR view of an employee's assets
   */
  async getEmployeeAssets(req, res, next) {
    try {
      const result = await assetService.getEmployeeAssets(
        req.user.organizationId,
        req.params.employeeId,
      );

      return res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new AssetController();
