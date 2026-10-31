const express = require("express");
const departmentController = require("../controllers/department.controller");
const {
  authenticate,
  authorizeRoles,
} = require("../middleware/auth.middleware");

const router = express.Router();

router.use(authenticate);

// 1. GET /api/departments - List departments
router.get("/", departmentController.list);

// Designations (job titles) inside departments. Declared before "/:id" so "designations" is not read as an id.
router.put("/designations/:designationId", authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "HR"), departmentController.renameDesignation);
router.delete("/designations/:designationId", authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "HR"), departmentController.removeDesignation);
router.post("/:id/designations", authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "HR"), departmentController.addDesignation);

// 2. GET /api/departments/:id - Get department by ID
router.get("/:id", departmentController.getById);

// 3. POST /api/departments - Create department
router.post(
  "/",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "HR"),
  departmentController.create,
);

// 4. PUT /api/departments/:id - Update department
router.put(
  "/:id",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "HR"),
  departmentController.update,
);

// 5. DELETE /api/departments/:id - Delete department
router.delete(
  "/:id",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "HR"),
  departmentController.remove,
);

module.exports = router;
