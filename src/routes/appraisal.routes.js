const express = require("express");
const appraisalController = require("../controllers/appraisal.controller");
const {
  authenticate,
  authorizeRoles,
} = require("../middleware/auth.middleware");

const router = express.Router();
router.use(authenticate);
router.get("/mine", appraisalController.mine);
router.get(
  "/",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  appraisalController.list,
);
router.post(
  "/",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN"),
  appraisalController.createCycle,
);
router.get(
  "/:id",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  appraisalController.get,
);
router.put("/reviews/:id/self", appraisalController.submitSelf);
router.put(
  "/reviews/:id/manager",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  appraisalController.submitManager,
);
module.exports = router;
