const express = require("express");
const orgController = require("../controllers/org.controller");
const {
  authenticate,
  authorizeRoles,
} = require("../middleware/auth.middleware");

const router = express.Router();
router.use(authenticate);
router.get("/", orgController.get);
router.put(
  "/",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN"),
  orgController.update,
);
module.exports = router;
