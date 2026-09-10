const express = require("express");
const shiftController = require("../controllers/shift.controller");
const { authenticate, authorizeRoles } = require("../middleware/auth.middleware");

const router = express.Router();

router.use(authenticate);

// 1. GET /api/shifts - List all organization shifts
router.get("/", shiftController.list);

// 2. GET /api/shifts/:id - Get shift by ID
router.get("/:id", shiftController.getById);

// 3. POST /api/shifts/simulate - Interactive calculation simulator
router.post("/simulate", shiftController.simulate);

// 4. POST /api/shifts - Create shift
router.post(
  "/",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  shiftController.create
);

// 5. PUT /api/shifts/:id - Update shift
router.put(
  "/:id",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  shiftController.update
);

// 6. DELETE /api/shifts/:id - Delete shift
router.delete(
  "/:id",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN"),
  shiftController.remove
);

// 7. POST /api/shifts/:id/assign - Assign employees to shift
router.post(
  "/:id/assign",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  shiftController.assign
);

module.exports = router;
