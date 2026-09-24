const express = require("express");
const policyController = require("../controllers/policy.controller");
const {
  authenticate,
  authorizeRoles,
} = require("../middleware/auth.middleware");

const router = express.Router();
router.use(authenticate);

// Any authenticated user can view the policy
router.get("/", policyController.getPolicy);

// Only Admin can update the policy
router.put(
  "/",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN"),
  policyController.upsertPolicy,
);

module.exports = router;
