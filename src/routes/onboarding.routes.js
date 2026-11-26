const express = require("express");
const router = express.Router();
const onboardingController = require("../controllers/onboarding.controller");
const {
  authenticate,
  authorizeRoles,
} = require("../middleware/auth.middleware");
const { documentUploader, handleUploadErrors } = require("../middleware/upload.middleware");

const portalUpload = documentUploader();

// ==========================================
// PUBLIC CANDIDATE PORTAL ROUTES
// ==========================================

// Candidate accesses portal via unique token
router.get("/portal/:token", onboardingController.getCandidateByToken);
router.get("/portal/:token/documents/:documentId/content", onboardingController.getPortalDocumentContent);

// Candidate submits / updates profile
router.put(
  "/portal/:token/profile",
  onboardingController.updateCandidateProfile,
);

// Candidate uploads mandatory onboarding document
router.post(
  "/portal/:token/documents",
  portalUpload.single("file"),
  onboardingController.uploadCandidateDocument,
);

// Candidate responds to offer letter (Accept / Reject)
router.post(
  "/portal/:token/respond-offer",
  onboardingController.respondToOffer,
);

// ==========================================
// AUTHENTICATED HR / ADMIN ROUTES
// ==========================================
router.use(authenticate);

// HR / Admin: List all joiners in pipeline
router.get(
  "/",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER", "HR"),
  onboardingController.listCandidates,
);

// HR / Admin: Create new joiner invitation
router.post(
  "/",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER", "HR"),
  onboardingController.createJoiner,
);

// HR / Admin: View single candidate complete dossier
router.get(
  "/:id",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER", "HR"),
  onboardingController.getCandidateDetails,
);
router.get(
  "/:id/documents/:documentId/content",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  onboardingController.getCandidateDocumentContent,
);

// HR: Verify candidate profile & review documents
router.put(
  "/:id/hr-verify",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER", "HR"),
  onboardingController.hrVerifyCandidate,
);

// Admin or HR: Approve candidate & Generate Offer Letter
router.post(
  "/:id/admin-approve-offer",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "HR"),
  onboardingController.adminApproveAndGenerateOffer,
);

// HR: Review Offer Letter & Send to Employee
router.post(
  "/:id/hr-send-offer",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER", "HR"),
  onboardingController.hrReviewAndSendOffer,
);

// Admin: Direct approval & automatic account activation
router.post(
  "/:id/admin-approve",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN"),
  onboardingController.adminApproveAndActivate,
);

// Admin confirms the candidate actually joined and activates the employee account.
router.post(
  "/:id/mark-joined",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN"),
  onboardingController.markJoined,
);

router.post(
  "/:id/reschedule-joining",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER", "HR"),
  onboardingController.rescheduleJoining,
);

router.post(
  "/:id/no-show",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER", "HR"),
  onboardingController.markNoShow,
);

router.use(handleUploadErrors);

module.exports = router;
