const express = require("express");
const expenseController = require("../controllers/expense.controller");
const {
  authenticate,
  authorizeRoles,
} = require("../middleware/auth.middleware");
const {
  documentUploader,
  handleUploadErrors,
} = require("../middleware/upload.middleware");
const { validate, schemas } = require("../middleware/validate.middleware");

const router = express.Router();

const upload = documentUploader(10);

const receiptUpload = (req, res, next) => {
  upload.fields([
    { name: "receipt", maxCount: 1 },
    { name: "file", maxCount: 1 },
    { name: "image", maxCount: 1 },
  ])(req, res, (err) => {
    if (err) return next(err);
    if (req.files) {
      req.file = req.files.receipt?.[0] || req.files.file?.[0] || req.files.image?.[0] || null;
    }
    next();
  });
};

router.use(authenticate);

// Submit new claim (supports file upload via 'receipt', 'file', or 'image')
router.post("/", receiptUpload, expenseController.createClaim);
router.post("/apply", receiptUpload, expenseController.createClaim);

// View employee's own claims
router.get("/my", expenseController.listMyClaims);

// Summary KPIs — org-wide spend figures
router.get("/summary", expenseController.getSummary);

// View claims (all for manager/admin, personal for employee)
router.get("/", expenseController.listOrganizationClaims);
router.patch(
  "/:id/review",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  validate(schemas.reviewRequest),
  expenseController.reviewClaim,
);
router.put(
  "/:id/review",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  validate(schemas.reviewRequest),
  expenseController.reviewClaim,
);

// Cancel/Delete pending claim (Employee)
router.delete("/:id", expenseController.deleteClaim);

router.use(handleUploadErrors);

module.exports = router;
