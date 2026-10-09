const express = require("express");
const companyLeaveController = require("../controllers/company-leave.controller");
const { authenticate, authorizeRoles } = require("../middleware/auth.middleware");

const router = express.Router();

router.use(authenticate);

// HR and admins announce or withdraw company leave; everyone can see it.
const hrOnly = authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER");

router.get("/", companyLeaveController.list);
router.post("/", hrOnly, companyLeaveController.create);
router.delete("/:id", hrOnly, companyLeaveController.remove);

module.exports = router;
