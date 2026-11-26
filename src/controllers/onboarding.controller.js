const onboardingService = require("../services/onboarding.service");

class OnboardingController {
  /**
   * POST /api/onboarding - HR/Admin creates new joiner invite
   */
  async createJoiner(req, res, next) {
    try {
      const organizationId = req.user.organizationId;
      const hrUserId = req.user.id;
      const result = await onboardingService.createJoiner(
        organizationId,
        hrUserId,
        req.body,
      );
      res.status(201).json({
        success: true,
        message:
          "New joiner created and invitation link generated successfully",
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
      const updated = await onboardingService.updateCandidateProfile(
        token,
        req.body,
      );
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
      const document = await onboardingService.uploadCandidateDocument(
        token,
        {
          ...(req.body || {}),
          file: req.file,
          documentType: req.body?.documentType,
          fileName: req.body?.fileName || req.file?.originalname,
          fileUrl: req.body?.fileUrl,
          fileSize: req.body?.fileSize || req.file?.size,
          mimeType: req.body?.mimeType || req.file?.mimetype,
        },
      );
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
      const candidates = await onboardingService.listCandidates(
        organizationId,
        req.query,
      );
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
      const candidate = await onboardingService.getCandidateDetails(
        organizationId,
        id,
      );
      res.status(200).json({
        success: true,
        data: candidate,
      });
    } catch (err) {
      next(err);
    }
  }

  async getPortalDocumentContent(req, res, next) {
    try {
      const file = await onboardingService.getPortalDocumentContent(req.params.token, req.params.documentId);
      res.setHeader("Content-Type", file.contentType);
      res.setHeader("Content-Disposition", `inline; filename="${String(file.fileName).replace(/[\"\r\n]/g, "_")}"`);
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      return res.status(200).send(file.buffer);
    } catch (err) { next(err); }
  }

  async getCandidateDocumentContent(req, res, next) {
    try {
      const file = await onboardingService.getCandidateDocumentContent(req.user.organizationId, req.params.id, req.params.documentId);
      res.setHeader("Content-Type", file.contentType);
      res.setHeader("Content-Disposition", `inline; filename="${String(file.fileName).replace(/[\"\r\n]/g, "_")}"`);
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      return res.status(200).send(file.buffer);
    } catch (err) { next(err); }
  }

  /**
   * PUT /api/onboarding/:id/hr-verify - HR verifies profile and documents
   */
  async hrVerifyCandidate(req, res, next) {
    try {
      const organizationId = req.user.organizationId;
      const { id } = req.params;
      const hrUserId = req.user.id;
      const verified = await onboardingService.hrVerifyCandidate(
        organizationId,
        id,
        hrUserId,
        req.body,
      );
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
      const result = await onboardingService.adminApproveAndActivate(
        organizationId,
        id,
        adminUserId,
        { ...(req.body || {}), actorRole: req.user.role },
      );
      res.status(200).json({
        success: true,
        message:
          "Employee successfully approved and account activated without an offer letter.",
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }

  async markJoined(req, res, next) {
    try {
      const result = await onboardingService.adminApproveAndActivate(
        req.user.organizationId,
        req.params.id,
        req.user.id,
        { ...(req.body || {}), actorRole: req.user.role, actualJoiningDate: req.body?.actualJoiningDate },
      );
      res.status(200).json({ success: true, message: "Candidate marked as joined and employee account activated", data: result });
    } catch (err) { next(err); }
  }

  async rescheduleJoining(req, res, next) {
    try {
      const result = await onboardingService.rescheduleJoining(req.user.organizationId, req.params.id, req.user.id, req.body || {});
      res.status(200).json({ success: true, message: "Joining date rescheduled successfully", data: result });
    } catch (err) { next(err); }
  }

  async markNoShow(req, res, next) {
    try {
      const result = await onboardingService.markNoShow(req.user.organizationId, req.params.id, req.user.id, req.body || {});
      res.status(200).json({ success: true, message: "Candidate marked as no-show", data: result });
    } catch (err) { next(err); }
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
        req.body,
      );
      res.status(200).json({
        success: true,
        message:
          "Candidate approved and official Offer Letter generated!",
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
        req.body,
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
