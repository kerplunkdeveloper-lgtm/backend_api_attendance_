const express = require("express");
const multer = require("multer");
const expenseController = require("../controllers/expense.controller");
const { authenticate, authorizeRoles } = require("../middleware/auth.middleware");

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit for receipts
  },
});

router.use(authenticate);

// Submit new claim (Employee) - supports file upload via 'receipt' or 'image'
router.post(
  "/",
  upload.single("receipt"),
  expenseController.createClaim
);
router.post(
  "/apply",
  upload.single("receipt"),
  expenseController.createClaim
);

// View employee's own claims
router.get("/my", expenseController.listMyClaims);

// Summary KPIs (HR / Manager / Admin)
router.get("/summary", expenseController.getSummary);

// View organization claims (Manager / Admin / HR)
router.get(
  "/",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  expenseController.listOrganizationClaims
);

// Review claim: Approve or Reject (Manager / Admin / HR)
router.patch(
  "/:id/review",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  expenseController.reviewClaim
);
router.put(
  "/:id/review",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  expenseController.reviewClaim
);

// Cancel/Delete pending claim (Employee)
router.delete("/:id", expenseController.deleteClaim);

module.exports = router;
