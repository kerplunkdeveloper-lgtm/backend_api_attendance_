const onboardingService = require("../services/onboarding.service");

class OnboardingController {
  /**
   * POST /api/onboarding - HR/Admin creates new joiner invite
   */
  async createJoiner(req, res, next) {
    try {
      const organizationId = req.user.organizationId;
      const hrUserId = req.user.id;
      const result = await onboardingService.createJoiner(organizationId, hrUserId, req.body);
      res.status(201).json({
        success: true,
        message: "New joiner created and invitation link generated successfully",
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/onboarding/portal/:token - Public candidate portal retrieval
   */
  async getCandidateByToken(req, res, next) {
    try {
      const { token } = req.params;
      const candidate = await onboardingService.getCandidateByToken(token);
      res.status(200).json({
        success: true,
        data: candidate,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * PUT /api/onboarding/portal/:token/profile - Public candidate profile submit
   */
  async updateCandidateProfile(req, res, next) {
    try {
      const { token } = req.params;
      const updated = await onboardingService.updateCandidateProfile(token, req.body);
      res.status(200).json({
        success: true,
        message: "Candidate profile submitted successfully",
        data: updated,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/onboarding/portal/:token/documents - Public candidate document upload
   */
  async uploadCandidateDocument(req, res, next) {
    try {
      const { token } = req.params;
      const document = await onboardingService.uploadCandidateDocument(token, req.body);
      res.status(201).json({
        success: true,
        message: "Document uploaded successfully",
        data: document,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/onboarding - List all candidates in pipeline
   */
  async listCandidates(req, res, next) {
    try {
      const organizationId = req.user.organizationId;
      const candidates = await onboardingService.listCandidates(organizationId, req.query);
      res.status(200).json({
        success: true,
        data: candidates,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/onboarding/:id - Get full candidate dossier
   */
  async getCandidateDetails(req, res, next) {
    try {
      const organizationId = req.user.organizationId;
      const { id } = req.params;
      const candidate = await onboardingService.getCandidateDetails(organizationId, id);
      res.status(200).json({
        success: true,
        data: candidate,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * PUT /api/onboarding/:id/hr-verify - HR verifies profile and documents
   */
  async hrVerifyCandidate(req, res, next) {
    try {
      const organizationId = req.user.organizationId;
      const { id } = req.params;
      const hrUserId = req.user.id;
      const verified = await onboardingService.hrVerifyCandidate(organizationId, id, hrUserId, req.body);
      res.status(200).json({
        success: true,
        message: "Candidate verification updated successfully",
        data: verified,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/onboarding/:id/admin-approve - Admin approval and account activation
   */
  async adminApproveAndActivate(req, res, next) {
    try {
      const organizationId = req.user.organizationId;
      const { id } = req.params;
      const adminUserId = req.user.id;
      const result = await onboardingService.adminApproveAndActivate(organizationId, id, adminUserId, req.body);
      res.status(200).json({
        success: true,
        message: "Employee successfully approved, account activated, and offer letter generated!",
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/onboarding/:id/admin-approve-offer - Admin Approval & Generate Offer Letter
   */
  async adminApproveAndGenerateOffer(req, res, next) {
    try {
      const organizationId = req.user.organizationId;
      const { id } = req.params;
      const adminUserId = req.user.id;
      const result = await onboardingService.adminApproveAndGenerateOffer(
        organizationId,
        id,
        adminUserId,
        req.body
      );
      res.status(200).json({
        success: true,
        message: "Candidate approved by Admin and official Offer Letter generated!",
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/onboarding/:id/hr-send-offer - HR Review & Send to Employee
   */
  async hrReviewAndSendOffer(req, res, next) {
    try {
      const organizationId = req.user.organizationId;
      const { id } = req.params;
      const hrUserId = req.user.id;
      const result = await onboardingService.hrReviewAndSendOffer(
        organizationId,
        id,
        hrUserId,
        req.body
      );
      res.status(200).json({
        success: true,
        message: "Offer letter reviewed by HR and dispatched to employee!",
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/onboarding/portal/:token/respond-offer - Candidate Accept / Reject Offer
   */
  async respondToOffer(req, res, next) {
    try {
      const { token } = req.params;
      const result = await onboardingService.respondToOffer(token, req.body);
      res.status(200).json({
        success: true,
        message: result.message,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new OnboardingController();
