const express = require("express");
const branchController = require("../controllers/branch.controller");
const {
  authenticate,
  authorizeRoles,
} = require("../middleware/auth.middleware");

const router = express.Router();

router.use(authenticate);

// 1. GET /api/branches - List branches
router.get("/", branchController.list);

// 2. GET /api/branches/:id - Get branch by ID
router.get("/:id", branchController.getById);

// 3. POST /api/branches - Create branch
router.post(
  "/",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  branchController.create,
);

// 4. PUT /api/branches/:id - Update branch
router.put(
  "/:id",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  branchController.update,
);

// 5. DELETE /api/branches/:id - Delete branch
router.delete(
  "/:id",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN"),
  branchController.remove,
);

module.exports = router;
