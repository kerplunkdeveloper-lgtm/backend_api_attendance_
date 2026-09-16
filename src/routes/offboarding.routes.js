const express = require("express");
const offboardingController = require("../controllers/offboarding.controller");
const { authenticate, authorizeRoles } = require("../middleware/auth.middleware");

const router = express.Router();

router.use(authenticate);

// 1. Employee self-service / own exit view
router.get("/my-exit", offboardingController.getMyExit);

// 2. Initiate exit (employee self-resignation OR Admin termination)
router.post("/initiate", offboardingController.initiateExit);

// 3. List exits (Admins & Managers)
router.get(
  "/",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  offboardingController.getExitList
);

// 4. Details of an exit
router.get(
  "/:id",
  offboardingController.getExitDetails
);

// 5. HR Review of Resignation (Admins & Managers)
router.post(
  "/:id/review",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  offboardingController.reviewResignation
);

// 6. Update Department Clearance Item
router.put(
  "/:id/clearances/:clearanceId",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  offboardingController.updateClearanceItem
);

// 7. Save Exit Interview
router.post(
  "/:id/interview",
  offboardingController.saveExitInterview
);

// 8. Calculate / Update Full & Final (F&F) Settlement
router.post(
  "/:id/calculate-settlement",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  offboardingController.calculateFinalSettlement
);

// 9. Disburse Settlement and Terminate Employee
router.post(
  "/:id/disburse-and-terminate",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN"),
  offboardingController.disburseSettlementAndTerminate
);

// 10. Printable Documents Data (F&F Statement, Relieving, Experience, Clearance)
router.get(
  "/:id/documents/:docType",
  offboardingController.getExitDocumentData
);

module.exports = router;
