const holidayService = require("../services/holiday.service");

class HolidayController {
  /**
   * Create a new holiday
   */
  async create(req, res) {
    try {
      const organizationId = req.user.organizationId;
      const holiday = await holidayService.createHoliday(
        organizationId,
        req.body,
      );
      return res.status(201).json({
        success: true,
        message: "Holiday created successfully",
        data: holiday,
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        message: error.message,
      });
    }
  }

  /**
   * Bulk import holidays
   */
  async bulkCreate(req, res) {
    try {
      const organizationId = req.user.organizationId;
      const { holidays } = req.body;
      const results = await holidayService.bulkCreateHolidays(
        organizationId,
        holidays,
      );
      return res.status(201).json({
        success: true,
        message: `Successfully imported ${results.created} holiday(s). Skipped: ${results.skipped}`,
        data: results,
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        message: error.message,
      });
    }
  }

  /**
   * List holidays with filters
   */
  async list(req, res) {
    try {
      const organizationId = req.user.organizationId;
      const holidays = await holidayService.getHolidays(
        organizationId,
        req.query,
      );
      return res.status(200).json({
        success: true,
        data: holidays,
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        message: error.message,
      });
    }
  }

  /**
   * Update holiday
   */
  async update(req, res) {
    try {
      const organizationId = req.user.organizationId;
      const { id } = req.params;
      const updated = await holidayService.updateHoliday(
        organizationId,
        id,
        req.body,
      );
      return res.status(200).json({
        success: true,
        message: "Holiday updated successfully",
        data: updated,
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        message: error.message,
      });
    }
  }

  /**
   * Delete holiday
   */
  async delete(req, res) {
    try {
      const organizationId = req.user.organizationId;
      const { id } = req.params;
      const result = await holidayService.deleteHoliday(organizationId, id);
      return res.status(200).json(result);
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        message: error.message,
      });
    }
  }

  /**
   * Get upcoming holidays
   */
  async upcoming(req, res) {
    try {
      const organizationId = req.user.organizationId;
      const branchId = req.query.branchId || req.user.employee?.branchId;
      const limit = parseInt(req.query.limit) || 5;
      const holidays = await holidayService.getUpcomingHolidays(
        organizationId,
        branchId,
        limit,
      );
      return res.status(200).json({
        success: true,
        data: holidays,
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        message: error.message,
      });
    }
  }
}

module.exports = new HolidayController();
