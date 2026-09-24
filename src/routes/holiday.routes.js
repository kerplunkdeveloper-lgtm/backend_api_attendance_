const express = require("express");
const holidayController = require("../controllers/holiday.controller");
const {
  authenticate,
  authorizeRoles,
} = require("../middleware/auth.middleware");

const router = express.Router();

router.use(authenticate);

// 1. GET /api/holidays - List holidays with filters (?year=2026&branchId=...&type=...)
router.get("/", holidayController.list);

// 2. GET /api/holidays/upcoming - Get upcoming holidays
router.get("/upcoming", holidayController.upcoming);

// 3. POST /api/holidays - Create single holiday
router.post(
  "/",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  holidayController.create,
);

// 4. POST /api/holidays/bulk - Bulk upload holiday list
router.post(
  "/bulk",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN"),
  holidayController.bulkCreate,
);

// 5. PUT /api/holidays/:id - Update existing holiday
router.put(
  "/:id",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  holidayController.update,
);

// 6. DELETE /api/holidays/:id - Remove holiday
router.delete(
  "/:id",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN"),
  holidayController.delete,
);

module.exports = router;
