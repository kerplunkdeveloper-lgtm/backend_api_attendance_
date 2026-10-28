const express = require("express");
const permissionController = require("../controllers/permission.controller");
const { authenticate, authorizeRoles } = require("../middleware/auth.middleware");

const router = express.Router();

router.use(authenticate);
router.use((req, res, next) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  next();
});

const reviewerOnly = authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER", "HR");

// Employee self-service
router.get("/my", permissionController.my);
router.post("/", permissionController.apply);
router.delete("/:id", permissionController.cancel);

// Review queue for admins and HR
router.get("/", reviewerOnly, permissionController.list);
router.put("/:id/review", reviewerOnly, permissionController.review);

module.exports = router;
