const express = require("express");
const router = express.Router();
const onboardingController = require("../controllers/onboarding.controller");
const {
  authenticate,
  authorizeRoles,
} = require("../middleware/auth.middleware");

// ==========================================
// PUBLIC CANDIDATE PORTAL ROUTES
// ==========================================

// Candidate accesses portal via unique token
router.get("/portal/:token", onboardingController.getCandidateByToken);

// Candidate submits / updates profile
router.put(
  "/portal/:token/profile",
  onboardingController.updateCandidateProfile,
);

// Candidate uploads mandatory onboarding document
router.post(
  "/portal/:token/documents",
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
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  onboardingController.listCandidates,
);

// HR / Admin: Create new joiner invitation
router.post(
  "/",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  onboardingController.createJoiner,
);

// HR / Admin: View single candidate complete dossier
router.get(
  "/:id",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  onboardingController.getCandidateDetails,
);

// HR: Verify candidate profile & review documents
router.put(
  "/:id/hr-verify",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  onboardingController.hrVerifyCandidate,
);

// Admin: Approve candidate & Generate Offer Letter
router.post(
  "/:id/admin-approve-offer",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN"),
  onboardingController.adminApproveAndGenerateOffer,
);

// HR: Review Offer Letter & Send to Employee
router.post(
  "/:id/hr-send-offer",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  onboardingController.hrReviewAndSendOffer,
);

// Admin: Direct approval & automatic account activation
router.post(
  "/:id/admin-approve",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN"),
  onboardingController.adminApproveAndActivate,
);

module.exports = router;
