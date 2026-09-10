require('dotenv').config();
const prisma = require('../src/config/database');
const onboardingService = require('../src/services/onboarding.service');

async function testOnboardingPipeline() {
  console.log('--- Testing New Joiner / Employee Onboarding Pipeline ---');

  const org = await prisma.organization.findFirst();
  if (!org) throw new Error('Organization not found');

  const adminUser = await prisma.user.findFirst({
    where: { organizationId: org.id, role: { in: ['SUPER_ADMIN', 'COMPANY_ADMIN'] } },
  });
  if (!adminUser) throw new Error('Admin user not found');

  let branch = await prisma.branch.findFirst({ where: { organizationId: org.id } });
  let department = await prisma.department.findFirst({ where: { organizationId: org.id } });

  const testEmail = `joiner.${Date.now()}@acme-workpulse.com`;

  // 1. HR/Admin creates New Joiner
  console.log('\n1. HR creates New Joiner...');
  const createResult = await onboardingService.createJoiner(org.id, adminUser.id, {
    firstName: 'Rohan',
    lastName: 'Sharma',
    email: testEmail,
    phone: '+91 9876543210',
    designation: 'Senior Full Stack Engineer',
    departmentId: department?.id,
    branchId: branch?.id,
    expectedJoinDate: '2026-10-01',
    proposedSalary: 85000,
  });

  const candidate = createResult.candidate;
  const token = candidate.token;
  console.log('✔ Joiner Created:', candidate.firstName, candidate.lastName);
  console.log('✔ Status:', candidate.status);
  console.log('✔ Onboarding URL token:', token);

  // 2. Candidate loads portal via token
  console.log('\n2. Candidate loads portal...');
  const portalData = await onboardingService.getCandidateByToken(token);
  console.log('✔ Portal loaded successfully for:', portalData.firstName, portalData.designation);
  console.log('✔ Organization:', portalData.organization.name);

  // 3. Employee fills complete profile
  console.log('\n3. Candidate fills complete profile...');
  const updatedProfile = await onboardingService.updateCandidateProfile(token, {
    dateOfBirth: '1995-06-15',
    gender: 'Male',
    bloodGroup: 'O+',
    maritalStatus: 'Single',
    currentAddress: '42 Orchid Residency, Indiranagar, Bengaluru, KA 560038',
    permanentAddress: '108 Civil Lines, Jaipur, RJ 302006',
    emergencyContactName: 'Kavita Sharma',
    emergencyContactPhone: '+91 9876500000',
    bankName: 'HDFC Bank',
    accountNumber: '50100234567890',
    ifscCode: 'HDFC0001234',
    panNumber: 'ABCDE1234F',
    aadhaarNumber: '1234-5678-9012',
  });
  console.log('✔ Profile Submitted. Status:', updatedProfile.status);
  console.log('✔ Bank details saved:', updatedProfile.bankName, updatedProfile.ifscCode);

  // 4. Candidate uploads documents
  console.log('\n4. Candidate uploads mandatory documents...');
  const doc1 = await onboardingService.uploadCandidateDocument(token, {
    documentType: 'GOVT_ID',
    fileName: 'aadhaar_card_front_back.pdf',
    fileUrl: 'https://docs.workpulse.io/demo/aadhaar.pdf',
    fileSize: 1048576,
    mimeType: 'application/pdf',
  });
  console.log('✔ Uploaded Document 1:', doc1.documentType, doc1.fileName);

  const doc2 = await onboardingService.uploadCandidateDocument(token, {
    documentType: 'TAX_ID',
    fileName: 'pan_card_copy.pdf',
    fileUrl: 'https://docs.workpulse.io/demo/pan.pdf',
    fileSize: 524288,
    mimeType: 'application/pdf',
  });
  console.log('✔ Uploaded Document 2:', doc2.documentType, doc2.fileName);

  const doc3 = await onboardingService.uploadCandidateDocument(token, {
    documentType: 'DEGREE_CERTIFICATE',
    fileName: 'btech_computer_science_degree.pdf',
    fileUrl: 'https://docs.workpulse.io/demo/degree.pdf',
    fileSize: 2097152,
    mimeType: 'application/pdf',
  });
  console.log('✔ Uploaded Document 3:', doc3.documentType, doc3.fileName);

  const candidateAfterDocs = await onboardingService.getCandidateByToken(token);
  console.log('✔ Status after uploading documents:', candidateAfterDocs.status);

  // 5. HR Verifies profile and documents
  console.log('\n5. HR verifies candidate profile & validates documents...');
  const hrVerification = await onboardingService.hrVerifyCandidate(org.id, candidate.id, adminUser.id, {
    hrNotes: 'All background documents inspected, credentials verified with university and previous employer.',
    documentVerifications: [
      { documentId: doc1.id, status: 'VERIFIED' },
      { documentId: doc2.id, status: 'VERIFIED' },
      { documentId: doc3.id, status: 'VERIFIED' },
    ],
    action: 'APPROVE',
  });
  console.log('✔ HR Verification Complete. Status:', hrVerification.status);
  console.log('✔ HR Notes:', hrVerification.hrNotes);

  // 6. Admin Approves and Activates Employee
  console.log('\n6. Admin gives final approval & activates employee account...');
  const activationResult = await onboardingService.adminApproveAndActivate(org.id, candidate.id, adminUser.id, {
    adminNotes: 'Welcome to the team! Approved with standard Senior Engineer compensation package.',
    initialPassword: 'TempPassword@2026',
    role: 'EMPLOYEE',
  });

  console.log('✔ User Account Created:', activationResult.user.email, 'Role:', activationResult.user.role);
  console.log('✔ Employee Profile Created:', activationResult.employee.firstName, activationResult.employee.employeeCode);
  console.log('✔ Candidate Status Updated To:', activationResult.candidate.status);
  console.log('✔ Offer Letter Ref Code:', activationResult.offerLetter.referenceNo);
  console.log('✔ Offer Letter CTC Gross Monthly:', activationResult.offerLetter.compensation.grossMonthly);

  // 7. Verify Offer Letter Generation
  console.log('\n7. Verifying Offer Letter retrieval...');
  const offerData = await onboardingService.generateOfferLetter(org.id, candidate.id);
  console.log('✔ Offer Letter Retrieved successfully!');
  console.log('  Candidate:', offerData.offerLetter.candidateName);
  console.log('  Designation:', offerData.offerLetter.designation);
  console.log('  Basic Pay:', offerData.offerLetter.compensation.basicMonthly);
  console.log('  HRA:', offerData.offerLetter.compensation.hraMonthly);
  console.log('  Special Allowance:', offerData.offerLetter.compensation.specialAllowanceMonthly);

  console.log('\n--- ALL ONBOARDING PIPELINE TESTS PASSED SUCCESSFULLY! ---');
  await prisma.$disconnect();
}

testOnboardingPipeline().catch((err) => {
  console.error('Test Failed:', err);
  process.exit(1);
});
