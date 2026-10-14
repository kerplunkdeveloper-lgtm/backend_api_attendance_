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
router.get("/late-coming-lop", policyController.listLateComingRules);
router.post("/late-coming-lop", authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN"), policyController.createLateComingRule);
router.put("/late-coming-lop/:id", authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN"), policyController.updateLateComingRule);
router.delete("/late-coming-lop/:id", authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN"), policyController.deleteLateComingRule);

// Only Admin can update the policy
router.put(
  "/",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN"),
  policyController.upsertPolicy,
);

module.exports = router;
