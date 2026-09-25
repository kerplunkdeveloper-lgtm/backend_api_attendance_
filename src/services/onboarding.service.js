const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../config/database");
const { uploadImage, uploadBuffer } = require("../config/cloudinary");
const emailService = require("./email.service");
const whatsappService = require("./whatsapp.service");
const { generateTempPassword, resolveAssignableRole } = require("../utils/password");
const { resolveAvatarUrl } = require("../utils/avatar");

class OnboardingService {
  /**
   * 1. HR/Admin: Create New Joiner invitation
   */
  async createJoiner(organizationId, hrUserId, data) {
    const {
      firstName,
      lastName,
      email,
      phone,
      designation,
      departmentId,
      branchId,
      shiftId,
      expectedJoinDate: expectedJoinDateRaw,
      joiningDate,
      proposedSalary: proposedSalaryRaw,
      offeredSalary,
    } = data;
    const expectedJoinDate = expectedJoinDateRaw || joiningDate;
    const proposedSalary = proposedSalaryRaw ?? offeredSalary;

    if (!firstName || !firstName.trim()) {
      const error = new Error("Candidate first name is required");
      error.statusCode = 400;
      throw error;
    }

    if (!email || !email.trim()) {
      const error = new Error("Candidate email is required");
      error.statusCode = 400;
      throw error;
    }

    if (!designation || !designation.trim()) {
      const error = new Error("Candidate designation/title is required");
      error.statusCode = 400;
      throw error;
    }

    if (!expectedJoinDate) {
      const error = new Error("Expected joining date is required");
      error.statusCode = 400;
      throw error;
    }

    const cleanEmail = email.trim().toLowerCase();

    // Check if an active user already exists with this email
    const existingUser = await prisma.user.findUnique({
      where: { organizationId_email: { organizationId, email: cleanEmail } },
    });
    if (existingUser) {
      const error = new Error(`A user account with email '${cleanEmail}' already exists in this organization`);
      error.statusCode = 400;
      throw error;
    }

    // Check if an onboarding candidate with this email is currently active in the pipeline
    const existingCandidate = await prisma.onboardingCandidate.findFirst({
      where: {
        organizationId,
        email: cleanEmail,
        status: { notIn: ["ACTIVATED", "REJECTED"] },
      },
    });
    if (existingCandidate) {
      const error = new Error(`An active onboarding record for '${cleanEmail}' already exists in pipeline`);
      error.statusCode = 400;
      throw error;
    }

    // Validate branch if provided
    if (branchId) {
      const branch = await prisma.branch.findFirst({
        where: { id: branchId, organizationId },
      });
      if (!branch) {
        const error = new Error("Selected branch was not found in this organization");
        error.statusCode = 404;
        throw error;
      }
    }

    // Validate department if provided
    if (departmentId) {
      const department = await prisma.department.findFirst({
        where: { id: departmentId, organizationId },
      });
      if (!department) {
        const error = new Error("Selected department was not found in this organization");
        error.statusCode = 404;
        throw error;
      }
    }

    // Validate shift if provided
    if (shiftId) {
      const shift = await prisma.shift.findFirst({
        where: { id: shiftId, organizationId },
      });
      if (!shift) {
        const error = new Error("Selected shift was not found in this organization");
        error.statusCode = 404;
        throw error;
      }
    }

    const token = crypto.randomUUID();
    const joinDateOnly = new Date(expectedJoinDate);

    const candidate = await prisma.onboardingCandidate.create({
      data: {
        organizationId,
        token,
        firstName: firstName.trim(),
        lastName: lastName ? lastName.trim() : null,
        email: cleanEmail,
        phone: phone ? phone.trim() : null,
        designation: designation.trim(),
        departmentId: departmentId || null,
        branchId: branchId || null,
        shiftId: shiftId || null,
        expectedJoinDate: joinDateOnly,
        proposedSalary: proposedSalary ? Number(proposedSalary) : null,
        status: "INVITED",
        hrReviewerId: hrUserId || null,
      },
      include: {
        branch: { select: { id: true, name: true } },
        department: { select: { id: true, name: true } },
      },
    });

    return {
      candidate,
      onboardingUrl: `/onboarding/portal/${token}`,
    };
  }

  /**
   * 2. Public Candidate Portal: Retrieve candidate information by token
   */
  async getCandidateByToken(token) {
    if (!token) {
      const error = new Error("Onboarding token is required");
      error.statusCode = 400;
      throw error;
    }

    const candidate = await prisma.onboardingCandidate.findUnique({
      where: { token },
      include: {
        organization: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true, address: true } },
        department: { select: { id: true, name: true } },
        documents: {
          select: {
            id: true,
            documentType: true,
            fileName: true,
            fileUrl: true,
            status: true,
            rejectionReason: true,
            createdAt: true,
          },
        },
      },
    });

    if (!candidate) {
      const error = new Error("Invalid or expired onboarding invitation link");
      error.statusCode = 404;
      throw error;
    }

    return candidate;
  }

  /**
   * 3. Candidate: Submit or update complete profile
   */
  async updateCandidateProfile(token, profileData) {
    const candidate = await prisma.onboardingCandidate.findUnique({
      where: { token },
    });

    if (!candidate) {
      const error = new Error("Invalid or expired onboarding link");
      error.statusCode = 404;
      throw error;
    }

    if (candidate.status === "ACTIVATED") {
      const error = new Error("This profile has already been activated and cannot be edited");
      error.statusCode = 400;
      throw error;
    }

    const {
      dateOfBirth,
      gender,
      bloodGroup,
      maritalStatus,
      currentAddress,
      permanentAddress,
      emergencyContactName,
      emergencyContactPhone,
      bankName,
      accountNumber,
      ifscCode,
      panNumber,
      aadhaarNumber,
    } = profileData;

    const updateFields = {};
    if (dateOfBirth) updateFields.dateOfBirth = new Date(dateOfBirth);
    if (gender !== undefined) updateFields.gender = gender ? String(gender).trim() : null;
    if (bloodGroup !== undefined) updateFields.bloodGroup = bloodGroup ? String(bloodGroup).trim() : null;
    if (maritalStatus !== undefined) updateFields.maritalStatus = maritalStatus ? String(maritalStatus).trim() : null;
    if (currentAddress !== undefined) updateFields.currentAddress = currentAddress ? String(currentAddress).trim() : null;
    if (permanentAddress !== undefined) updateFields.permanentAddress = permanentAddress ? String(permanentAddress).trim() : null;
    if (emergencyContactName !== undefined) updateFields.emergencyContactName = emergencyContactName ? String(emergencyContactName).trim() : null;
    if (emergencyContactPhone !== undefined) updateFields.emergencyContactPhone = emergencyContactPhone ? String(emergencyContactPhone).trim() : null;
    if (bankName !== undefined) updateFields.bankName = bankName ? String(bankName).trim() : null;
    if (accountNumber !== undefined) updateFields.accountNumber = accountNumber ? String(accountNumber).trim() : null;
    if (ifscCode !== undefined) updateFields.ifscCode = ifscCode ? String(ifscCode).trim().toUpperCase() : null;
    if (panNumber !== undefined) updateFields.panNumber = panNumber ? String(panNumber).trim().toUpperCase() : null;
    if (aadhaarNumber !== undefined) updateFields.aadhaarNumber = aadhaarNumber ? String(aadhaarNumber).trim() : null;

    // Advance status from INVITED to PROFILE_SUBMITTED if initial submission
    if (candidate.status === "INVITED") {
      updateFields.status = "PROFILE_SUBMITTED";
    }

    return await prisma.onboardingCandidate.update({
      where: { token },
      data: updateFields,
      include: {
        documents: true,
        branch: { select: { id: true, name: true } },
        department: { select: { id: true, name: true } },
      },
    });
  }

  /**
   * 4. Candidate: Upload onboarding document
   */
  async uploadCandidateDocument(token, docData = {}, file = null) {
    const candidate = await prisma.onboardingCandidate.findUnique({
      where: { token },
      include: { documents: true },
    });

    if (!candidate) {
      const error = new Error("Invalid or expired onboarding link");
      error.statusCode = 404;
      throw error;
    }

    if (["ACTIVATED", "REJECTED", "OFFER_REJECTED"].includes(candidate.status)) {
      throw Object.assign(new Error("This invitation no longer accepts uploads"), { statusCode: 403 });
    }
    const { documentType } = docData;
    if (file) {
      const { assertSniffedType } = require("../middleware/upload.middleware");
      assertSniffedType(file);
      const signature = file.buffer.subarray(0, 12);
      const recognized = (file.mimetype === "application/pdf" && signature.subarray(0, 5).toString() === "%PDF-") ||
        (file.mimetype === "image/png" && signature.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) ||
        (file.mimetype === "image/jpeg" && signature[0] === 255 && signature[1] === 216 && signature[2] === 255) ||
        (file.mimetype === "image/webp" && signature.subarray(0,4).toString() === "RIFF" && signature.subarray(8,12).toString() === "WEBP");
      if (!recognized) throw Object.assign(new Error("Invalid file contents"), { statusCode: 415 });
      if (!["GOVT_ID", "TAX_ID", "DEGREE_CERTIFICATE", "PREVIOUS_EXPERIENCE", "BANK_PROOF", "PHOTO", "OTHER"].includes(String(documentType).toUpperCase())) {
        throw Object.assign(new Error("Invalid document type"), { statusCode: 400 });
      }
      const stored = await uploadBuffer(file.buffer, { folder: `workpulse/onboarding/${candidate.id}`, resource_type: "auto" });
      docData = { ...docData, fileName: file.originalname, fileUrl: stored.secure_url, fileSize: file.size, mimeType: file.mimetype };
    }
    const { fileName, fileUrl, fileSize, mimeType } = docData;

    if (!documentType || !fileName || !fileUrl) {
      const error = new Error("documentType, fileName, and fileUrl are required");
      error.statusCode = 400;
      throw error;
    }

    const validTypes = [
      "GOVT_ID",
      "TAX_ID",
      "DEGREE_CERTIFICATE",
      "PREVIOUS_EXPERIENCE",
      "BANK_PROOF",
      "PHOTO",
      "OTHER",
    ];

    const cleanType = String(documentType).toUpperCase();
    if (!validTypes.includes(cleanType)) {
      const error = new Error(`Invalid documentType. Must be one of: ${validTypes.join(", ")}`);
      error.statusCode = 400;
      throw error;
    }

    // Auto-upload to Cloudinary if base64 / data URI
    let finalFileUrl = fileUrl.trim();
    if (typeof finalFileUrl === "string" && finalFileUrl.startsWith("data:")) {
      try {
        const uploadRes = await uploadImage(finalFileUrl, {
          folder: `workpulse/onboarding/${candidate.id}`,
          resource_type: "auto",
        });
        if (uploadRes && uploadRes.secure_url) {
          finalFileUrl = uploadRes.secure_url;
        } else {
          const error = new Error("Document upload failed. Please retry.");
          error.statusCode = 503;
          throw error;
        }
      } catch (cloudErr) {
        const error = new Error("Document upload failed. Please retry.");
        error.statusCode = 503;
        throw error;
      }
    }

    // Save document
    const document = await prisma.onboardingDocument.create({
      data: {
        candidateId: candidate.id,
        documentType: cleanType,
        fileName: fileName.trim(),
        fileUrl: finalFileUrl,
        fileSize: fileSize ? Number(fileSize) : null,
        mimeType: mimeType ? String(mimeType).trim() : null,
        status: "PENDING",
      },
    });

    // Advance candidate status to UNDER_HR_REVIEW if profile was already submitted
    if (["INVITED", "PROFILE_SUBMITTED"].includes(candidate.status)) {
      await prisma.onboardingCandidate.update({
        where: { id: candidate.id },
        data: { status: "UNDER_HR_REVIEW" },
      });
    }

    return document;
  }

  /**
   * 5. HR/Admin: List all candidates in pipeline
   */
  async listCandidates(organizationId, filters = {}) {
    const { status, departmentId, branchId, search } = filters;

    const where = { organizationId };

    if (status && status !== "ALL") {
      where.status = status;
    }
    if (departmentId && departmentId !== "ALL") {
      where.departmentId = departmentId;
    }
    if (branchId && branchId !== "ALL") {
      where.branchId = branchId;
    }
    if (search && search.trim()) {
      const term = search.trim();
      where.OR = [
        { firstName: { contains: term, mode: "insensitive" } },
        { lastName: { contains: term, mode: "insensitive" } },
        { email: { contains: term, mode: "insensitive" } },
        { designation: { contains: term, mode: "insensitive" } },
      ];
    }

    return await prisma.onboardingCandidate.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        branch: { select: { id: true, name: true } },
        department: { select: { id: true, name: true } },
        documents: {
          select: {
            id: true,
            documentType: true,
            status: true,
          },
        },
      },
    });
  }

  /**
   * 6. HR/Admin: Get single candidate complete dossier
   */
  async getCandidateDetails(organizationId, candidateId) {
    const candidate = await prisma.onboardingCandidate.findFirst({
      where: { id: candidateId, organizationId },
      include: {
        organization: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true, address: true } },
        department: { select: { id: true, name: true } },
        documents: { orderBy: { createdAt: "asc" } },
      },
    });

    if (!candidate) {
      const error = new Error("Candidate record not found");
      error.statusCode = 404;
      throw error;
    }

    return candidate;
  }

  /**
   * 7. HR: Verify Candidate Profile and Documents
   */
  async hrVerifyCandidate(organizationId, candidateId, hrUserId, verificationData) {
    const candidate = await prisma.onboardingCandidate.findFirst({
      where: { id: candidateId, organizationId },
      include: { documents: true },
    });

    if (!candidate) {
      const error = new Error("Candidate record not found");
      error.statusCode = 404;
      throw error;
    }

    if (candidate.status === "ACTIVATED") {
      const error = new Error("Candidate has already been activated");
      error.statusCode = 400;
      throw error;
    }

    const { hrNotes, documentVerifications = [], action = "APPROVE" } = verificationData;

    // Update individual document statuses if supplied
    for (const docReview of documentVerifications) {
      const { documentId, status, rejectionReason } = docReview;
      if (documentId && ["VERIFIED", "REJECTED"].includes(status)) {
        await prisma.onboardingDocument.updateMany({
          where: { id: documentId, candidateId: candidate.id },
          data: {
            status,
            rejectionReason: status === "REJECTED" ? rejectionReason || "Document rejected by HR" : null,
            verifiedBy: hrUserId,
            verifiedAt: new Date(),
          },
        });
      }
    }

    // Refresh document records to check verification completion
    const updatedDocs = await prisma.onboardingDocument.findMany({
      where: { candidateId: candidate.id },
    });

    let newStatus = candidate.status;
    if (action === "REJECT") {
      newStatus = "REJECTED";
    } else {
      // If HR explicitly verifies candidate, transition to HR_VERIFIED
      newStatus = "HR_VERIFIED";
    }

    return await prisma.onboardingCandidate.update({
      where: { id: candidate.id },
      data: {
        status: newStatus,
        hrReviewerId: hrUserId,
        hrNotes: hrNotes ? String(hrNotes).trim() : candidate.hrNotes,
        hrVerifiedAt: new Date(),
      },
      include: {
        documents: true,
        branch: { select: { id: true, name: true } },
        department: { select: { id: true, name: true } },
      },
    });
  }

  /**
   * 8. Admin: Final Approval and Automatic Account Activation
   */
  async adminApproveAndActivate(organizationId, candidateId, adminUserId, approvalData = {}) {
    const candidate = await prisma.onboardingCandidate.findFirst({
      where: { id: candidateId, organizationId },
      include: {
        organization: true,
        branch: true,
        department: true,
        documents: true,
      },
    });

    if (!candidate) {
      const error = new Error("Candidate record not found");
      error.statusCode = 404;
      throw error;
    }

    if (candidate.status === "ACTIVATED") {
      const error = new Error("This candidate profile has already been activated");
      error.statusCode = 400;
      throw error;
    }

    const existingUser = await prisma.user.findUnique({
      where: {
        organizationId_email: {
          organizationId,
          email: candidate.email,
        },
      },
    });
    if (existingUser) {
      const error = new Error(`User account with email '${candidate.email}' already exists in this organization`);
      error.statusCode = 400;
      throw error;
    }

    // Check organization subscription limit
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      include: { subscription: true },
    });
    if (org) {
      const activeEmployeesCount = await prisma.employee.count({
        where: { organizationId, status: "ACTIVE" },
      });
      const maxAllowed = org.subscription?.maxEmployees || org.maxEmployees || 10;
      if (activeEmployeesCount >= maxAllowed) {
        const error = new Error(
          `Cannot activate candidate: employee limit reached for current subscription plan (${maxAllowed} active employees max). Please upgrade subscription.`
        );
        error.statusCode = 400;
        throw error;
      }
    }

    const {
      adminNotes,
      initialPassword,
      employeeCode,
      role = "EMPLOYEE",
    } = approvalData;

    const tempPassword = initialPassword && String(initialPassword).trim()
      ? String(initialPassword).trim()
      : generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 10);
    const assignedRole = resolveAssignableRole(role, "COMPANY_ADMIN");
    const finalEmployeeCode =
      employeeCode?.trim() || `EMP-${Date.now().toString().slice(-6)}`;

    // Prepare Offer Letter data compilation
    const offerLetterRef = `WP-OFF-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const salaryVal = candidate.proposedSalary ? Number(candidate.proposedSalary) : 50000;
    const basic = Math.round(salaryVal * 0.5);
    const hra = Math.round(salaryVal * 0.3);
    const specialAllowance = Math.round(salaryVal * 0.2);

    const offerLetterData = {
      referenceNo: offerLetterRef,
      issuedDate: new Date().toISOString().split("T")[0],
      candidateName: `${candidate.firstName} ${candidate.lastName || ""}`.trim(),
      email: candidate.email,
      phone: candidate.phone,
      currentAddress: candidate.currentAddress || "Not specified",
      designation: candidate.designation,
      department: candidate.department?.name || "General",
      branch: candidate.branch?.name || "Corporate Headquarters",
      expectedJoinDate: candidate.expectedJoinDate.toISOString().split("T")[0],
      organizationName: candidate.organization.name,
      compensation: {
        ctcAnnual: salaryVal * 12,
        grossMonthly: salaryVal,
        basicMonthly: basic,
        hraMonthly: hra,
        specialAllowanceMonthly: specialAllowance,
      },
      terms: {
        probationMonths: 3,
        noticePeriodDays: 30,
        workingHours: "09:00 AM - 06:00 PM (Monday to Friday)",
      },
    };

    // Execute atomic transaction for user, employee, candidate activation, and offer letter
    const result = await prisma.$transaction(async (tx) => {
      // 1. Create User
      const newUser = await tx.user.create({
        data: {
          organizationId,
          email: candidate.email,
          passwordHash,
          role: assignedRole,
          mustChangePassword: true,
          isActive: true,
        },
      });

      const candidateAvatar = resolveAvatarUrl({
        firstName: candidate.firstName,
        lastName: candidate.lastName,
        employeeCode: finalEmployeeCode,
      });

      // 2. Create Employee
      const newEmployee = await tx.employee.create({
        data: {
          organizationId,
          userId: newUser.id,
          employeeCode: finalEmployeeCode,
          firstName: candidate.firstName,
          lastName: candidate.lastName,
          phone: candidate.phone,
          avatarUrl: candidateAvatar,
          status: "ACTIVE",
          branchId: candidate.branchId,
          departmentId: candidate.departmentId,
          shiftId: candidate.shiftId,
          // Promote the fields the candidate already provided so they are not
          // silently dropped after conversion.
          designation: candidate.designation || null,
          dateOfJoining: candidate.expectedJoinDate || candidate.dateOfJoining || null,
          dateOfBirth: candidate.dateOfBirth || null,
          workEmail: candidate.email || null,
          panNumber: candidate.panNumber || null,
          uanNumber: candidate.uanNumber || null,
          bankName: candidate.bankName || null,
          bankAccountNumber: candidate.accountNumber || candidate.bankAccountNumber || null,
          bankIfsc: candidate.ifscCode || candidate.bankIfsc || null,
          emergencyContactName: candidate.emergencyContactName || null,
          emergencyContactPhone: candidate.emergencyContactPhone || null,
          address: candidate.currentAddress || candidate.permanentAddress || candidate.address || null,
        },
      });

      // 3. Create initial Salary Structure
      await tx.salaryStructure.create({
        data: {
          organizationId,
          employeeId: newEmployee.id,
          baseSalary: basic,
          hra: hra,
          special: specialAllowance,
        },
      });

      // 4. Update Candidate Record to ACTIVATED with offer letter details
      const activatedCandidate = await tx.onboardingCandidate.update({
        where: { id: candidate.id },
        data: {
          status: "ACTIVATED",
          adminApproverId: adminUserId,
          adminNotes: adminNotes ? String(adminNotes).trim() : null,
          adminApprovedAt: new Date(),
          employeeId: newEmployee.id,
          offerLetterRef,
          offerLetterData,
          offerLetterGeneratedAt: new Date(),
        },
        include: {
          branch: { select: { id: true, name: true } },
          department: { select: { id: true, name: true } },
          documents: true,
        },
      });

      return {
        user: newUser,
        employee: newEmployee,
        candidate: activatedCandidate,
        offerLetter: offerLetterData,
        temporaryPassword: tempPassword,
      };
    });

    // Asynchronously dispatch Offer Letter notifications via Email and WhatsApp
    const candEmail = candidate.email;
    const candPhone = candidate.phone;
    const candName = `${candidate.firstName} ${candidate.lastName || ""}`.trim();
    const offerUrl = `${process.env.FRONTEND_URL || "http://localhost:3000"}/onboarding/portal/${candidate.portalToken}`;

    if (candEmail && result.temporaryPassword) {
      emailService
        .sendEmployeeWelcomeEmail(candEmail, candName, {
          organizationName: candidate.organization?.name || "WorkPulse",
          tempPassword: result.temporaryPassword,
          loginUrl: `${process.env.FRONTEND_URL || "http://localhost:3000"}/login`,
          role: "EMPLOYEE",
        })
        .catch((e) => console.warn("[OnboardingActivate] Welcome email failed:", e.message));
    }

    if (candEmail) {
      emailService
        .sendOfferLetterEmail(candEmail, candName, {
          designation: candidate.designation,
          department: candidate.department?.name,
          expectedJoinDate: candidate.expectedJoinDate,
          salary: candidate.proposedSalary,
          offerUrl,
        })
        .catch((e) => console.warn("[OfferNotification:Email] Error:", e.message));
    }

    if (candPhone) {
      whatsappService
        .sendOfferLetterWhatsApp(candPhone, candName, {
          designation: candidate.designation,
          offerUrl,
        })
        .catch((e) => console.warn("[OfferNotification:WhatsApp] Error:", e.message));
    }

    return result;
  }

  /**
   * 9. Generate or Retrieve Offer Letter
   */
  async generateOfferLetter(organizationId, candidateId) {
    const candidate = await prisma.onboardingCandidate.findFirst({
      where: { id: candidateId, organizationId },
      include: {
        organization: true,
        branch: true,
        department: true,
      },
    });

    if (!candidate) {
      const error = new Error("Candidate record not found");
      error.statusCode = 404;
      throw error;
    }

    if (candidate.offerLetterData) {
      return {
        offerLetter: candidate.offerLetterData,
        referenceNo: candidate.offerLetterRef,
        generatedAt: candidate.offerLetterGeneratedAt,
      };
    }

    // Generate on demand if not yet cached
    const offerLetterRef =
      candidate.offerLetterRef ||
      `WP-OFF-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const salaryVal = candidate.proposedSalary ? Number(candidate.proposedSalary) : 50000;
    const basic = Math.round(salaryVal * 0.5);
    const hra = Math.round(salaryVal * 0.3);
    const specialAllowance = Math.round(salaryVal * 0.2);

    const offerLetterData = {
      referenceNo: offerLetterRef,
      issuedDate: new Date().toISOString().split("T")[0],
      candidateName: `${candidate.firstName} ${candidate.lastName || ""}`.trim(),
      email: candidate.email,
      phone: candidate.phone,
      currentAddress: candidate.currentAddress || "Not specified",
      designation: candidate.designation,
      department: candidate.department?.name || "General",
      branch: candidate.branch?.name || "Corporate Headquarters",
      expectedJoinDate: candidate.expectedJoinDate.toISOString().split("T")[0],
      organizationName: candidate.organization.name,
      compensation: {
        ctcAnnual: salaryVal * 12,
        grossMonthly: salaryVal,
        basicMonthly: basic,
        hraMonthly: hra,
        specialAllowanceMonthly: specialAllowance,
      },
      terms: {
        probationMonths: 3,
        noticePeriodDays: 30,
        workingHours: "09:00 AM - 06:00 PM (Monday to Friday)",
      },
    };

    await prisma.onboardingCandidate.update({
      where: { id: candidate.id },
      data: {
        offerLetterRef,
        offerLetterData,
        offerLetterGeneratedAt: new Date(),
      },
    });

    return {
      offerLetter: offerLetterData,
      referenceNo: offerLetterRef,
      generatedAt: new Date(),
    };
  }

  /**
   * 10. Admin Approval -> Generate Offer Letter
   */
  async adminApproveAndGenerateOffer(organizationId, candidateId, adminUserId, approvalData = {}) {
    const candidate = await prisma.onboardingCandidate.findFirst({
      where: { id: candidateId, organizationId },
      include: { organization: true, branch: true, department: true },
    });

    if (!candidate) {
      const error = new Error("Candidate record not found");
      error.statusCode = 404;
      throw error;
    }

    const { adminNotes } = approvalData;

    // Generate Offer Letter
    const offerLetterRef = `WP-OFF-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const salaryVal = candidate.proposedSalary ? Number(candidate.proposedSalary) : 50000;
    const basic = Math.round(salaryVal * 0.5);
    const hra = Math.round(salaryVal * 0.3);
    const specialAllowance = Math.round(salaryVal * 0.2);

    const offerLetterData = {
      referenceNo: offerLetterRef,
      issuedDate: new Date().toISOString().split("T")[0],
      candidateName: `${candidate.firstName} ${candidate.lastName || ""}`.trim(),
      email: candidate.email,
      phone: candidate.phone,
      currentAddress: candidate.currentAddress || "Not specified",
      designation: candidate.designation,
      department: candidate.department?.name || "General",
      branch: candidate.branch?.name || "Corporate Headquarters",
      expectedJoinDate: candidate.expectedJoinDate.toISOString().split("T")[0],
      organizationName: candidate.organization.name,
      compensation: {
        ctcAnnual: salaryVal * 12,
        grossMonthly: salaryVal,
        basicMonthly: basic,
        hraMonthly: hra,
        specialAllowanceMonthly: specialAllowance,
      },
      terms: {
        probationMonths: 3,
        noticePeriodDays: 30,
        workingHours: "09:00 AM - 06:00 PM (Monday to Friday)",
      },
    };

    return await prisma.onboardingCandidate.update({
      where: { id: candidate.id },
      data: {
        status: "OFFER_GENERATED",
        adminApproverId: adminUserId,
        adminNotes: adminNotes ? String(adminNotes).trim() : null,
        adminApprovedAt: new Date(),
        offerLetterRef,
        offerLetterData,
        offerLetterGeneratedAt: new Date(),
      },
      include: {
        branch: { select: { id: true, name: true } },
        department: { select: { id: true, name: true } },
        documents: true,
      },
    });
  }

  /**
   * 11. HR Review -> Send to Employee
   */
  async hrReviewAndSendOffer(organizationId, candidateId, hrUserId, sendData = {}) {
    const candidate = await prisma.onboardingCandidate.findFirst({
      where: { id: candidateId, organizationId },
    });

    if (!candidate) {
      const error = new Error("Candidate record not found");
      error.statusCode = 404;
      throw error;
    }

    if (!candidate.offerLetterData) {
      const error = new Error("Offer letter has not been generated yet by Admin");
      error.statusCode = 400;
      throw error;
    }

    const { hrReviewNotes } = sendData;

    return await prisma.onboardingCandidate.update({
      where: { id: candidate.id },
      data: {
        status: "OFFER_SENT",
        offerSentAt: new Date(),
        hrNotes: hrReviewNotes ? String(hrReviewNotes).trim() : candidate.hrNotes,
      },
      include: {
        branch: { select: { id: true, name: true } },
        department: { select: { id: true, name: true } },
        documents: true,
      },
    });
  }

  /**
   * 12. Employee Accept / Reject Offer
   */
  async respondToOffer(token, responseData) {
    const candidate = await prisma.onboardingCandidate.findUnique({
      where: { token },
      include: { organization: true, branch: true, department: true },
    });

    if (!candidate) {
      const error = new Error("Invalid or expired onboarding token");
      error.statusCode = 404;
      throw error;
    }

    const { action, signature, reason } = responseData;

    if (!["ACCEPT", "REJECT"].includes(action)) {
      const error = new Error("Invalid action. Must be 'ACCEPT' or 'REJECT'");
      error.statusCode = 400;
      throw error;
    }

    if (action === "REJECT") {
      const rejected = await prisma.onboardingCandidate.update({
        where: { id: candidate.id },
        data: {
          status: "OFFER_REJECTED",
          offerRejectReason: reason ? String(reason).trim() : "Candidate declined offer terms",
          offerRespondedAt: new Date(),
        },
      });
      return {
        status: "OFFER_REJECTED",
        message: "Offer declined successfully",
        candidate: rejected,
      };
    }

    // action === "ACCEPT"
    if (!signature || !signature.trim()) {
      const error = new Error("Digital signature is required to accept the offer letter");
      error.statusCode = 400;
      throw error;
    }

    // Provision user & employee account upon acceptance if not already created
    let employeeId = candidate.employeeId;
    let newEmployee = null;

    if (!employeeId) {
      const tempPassword = generateTempPassword();
      const passwordHash = await bcrypt.hash(tempPassword, 10);
      const finalEmployeeCode = `EMP-${Date.now().toString().slice(-6)}`;
      const salaryVal = candidate.proposedSalary ? Number(candidate.proposedSalary) : 50000;
      const basic = Math.round(salaryVal * 0.5);
      const hra = Math.round(salaryVal * 0.3);
      const specialAllowance = Math.round(salaryVal * 0.2);

      const created = await prisma.$transaction(async (tx) => {
        let u = await tx.user.findUnique({
          where: {
            organizationId_email: {
              organizationId: candidate.organizationId,
              email: candidate.email,
            },
          },
        });
        if (!u) {
          u = await tx.user.create({
            data: {
              organizationId: candidate.organizationId,
              email: candidate.email,
              passwordHash,
              role: "EMPLOYEE",
              mustChangePassword: true,
              isActive: true,
            },
          });
        }

        const candidateAvatar = resolveAvatarUrl({
          firstName: candidate.firstName,
          lastName: candidate.lastName,
          employeeCode: finalEmployeeCode,
        });

        const emp = await tx.employee.create({
          data: {
            organizationId: candidate.organizationId,
            userId: u.id,
            employeeCode: finalEmployeeCode,
            firstName: candidate.firstName,
            lastName: candidate.lastName,
            phone: candidate.phone,
            avatarUrl: candidateAvatar,
            status: "ACTIVE",
            branchId: candidate.branchId,
            departmentId: candidate.departmentId,
            shiftId: candidate.shiftId,
            designation: candidate.designation || null,
            dateOfJoining: candidate.expectedJoinDate || candidate.dateOfJoining || null,
            dateOfBirth: candidate.dateOfBirth || null,
            workEmail: candidate.email || null,
            panNumber: candidate.panNumber || null,
            uanNumber: candidate.uanNumber || null,
            bankName: candidate.bankName || null,
            bankAccountNumber: candidate.accountNumber || candidate.bankAccountNumber || null,
            bankIfsc: candidate.ifscCode || candidate.bankIfsc || null,
            emergencyContactName: candidate.emergencyContactName || null,
            emergencyContactPhone: candidate.emergencyContactPhone || null,
            address: candidate.currentAddress || candidate.permanentAddress || candidate.address || null,
          },
        });

        await tx.salaryStructure.create({
          data: {
            organizationId: candidate.organizationId,
            employeeId: emp.id,
            baseSalary: basic,
            hra: hra,
            special: specialAllowance,
          },
        });

        return { user: u, employee: emp };
      });

      employeeId = created.employee.id;
      newEmployee = created.employee;

      emailService
        .sendEmployeeWelcomeEmail(candidate.email, `${candidate.firstName} ${candidate.lastName || ""}`.trim(), {
          organizationName: candidate.organization?.name || "WorkPulse",
          tempPassword,
          loginUrl: `${process.env.FRONTEND_URL || "http://localhost:3000"}/login`,
          role: "EMPLOYEE",
        })
        .catch((e) => console.warn("[OnboardingAccept] Welcome email failed:", e.message));
    }

    const accepted = await prisma.onboardingCandidate.update({
      where: { id: candidate.id },
      data: {
        status: "OFFER_ACCEPTED",
        candidateSignature: signature.trim(),
        offerRespondedAt: new Date(),
        employeeId,
      },
      include: {
        branch: { select: { id: true, name: true } },
        department: { select: { id: true, name: true } },
      },
    });

    return {
      status: "OFFER_ACCEPTED",
      message: "Offer letter accepted successfully! Welcome to the team.",
      candidate: accepted,
      employee: newEmployee,
    };
  }
}

module.exports = new OnboardingService();
