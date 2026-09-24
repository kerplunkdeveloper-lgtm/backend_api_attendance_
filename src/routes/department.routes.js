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

// 2. GET /api/departments/:id - Get department by ID
router.get("/:id", departmentController.getById);

// 3. POST /api/departments - Create department
router.post(
  "/",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN"),
  departmentController.create,
);

// 4. PUT /api/departments/:id - Update department
router.put(
  "/:id",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN"),
  departmentController.update,
);

// 5. DELETE /api/departments/:id - Delete department
router.delete(
  "/:id",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN"),
  departmentController.remove,
);

module.exports = router;
