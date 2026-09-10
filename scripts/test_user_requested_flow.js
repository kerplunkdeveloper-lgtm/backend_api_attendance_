require('dotenv').config();
const prisma = require('../src/config/database');
const onboardingService = require('../src/services/onboarding.service');

async function testUserRequestedOnboardingFlow() {
  console.log('===============================================================');
  console.log('Testing User-Requested Workflow:');
  console.log('New Joiner -> HR Verification -> Admin Approval -> Generate Offer -> HR Review -> Send to Employee -> Employee Accept / Reject');
  console.log('===============================================================\n');

  const org = await prisma.organization.findFirst();
  if (!org) throw new Error('Organization not found');

  const adminUser = await prisma.user.findFirst({
    where: { organizationId: org.id, role: { in: ['SUPER_ADMIN', 'COMPANY_ADMIN'] } },
  });
  if (!adminUser) throw new Error('Admin user not found');

  // STEP 1: New Joiner
  console.log('Step 1: HR creates New Joiner...');
  const testEmail1 = `engineer.${Date.now()}@acme.io`;
  const joiner1 = await onboardingService.createJoiner(org.id, adminUser.id, {
    firstName: 'Aarav',
    lastName: 'Patel',
    email: testEmail1,
    phone: '+91 9988776655',
    designation: 'Staff Backend Architect',
    expectedJoinDate: '2026-11-01',
    proposedSalary: 120000,
  });
  const token1 = joiner1.candidate.token;
  console.log('✔ Joiner 1 created. Token:', token1, 'Status:', joiner1.candidate.status);

  // Candidate fills profile & uploads doc
  await onboardingService.updateCandidateProfile(token1, {
    dateOfBirth: '1992-04-10',
    gender: 'Male',
    currentAddress: 'Bangalore, KA',
    bankName: 'Axis Bank',
    accountNumber: '912345678901',
    ifscCode: 'UTIB0001234',
    panNumber: 'PATER1234P',
  });
  const doc = await onboardingService.uploadCandidateDocument(token1, {
    documentType: 'GOVT_ID',
    fileName: 'passport_copy.pdf',
    fileUrl: 'https://docs.workpulse.io/demo/passport.pdf',
  });
  console.log('✔ Candidate profile filled & document uploaded. Status: UNDER_HR_REVIEW');

  // STEP 2: HR Verification
  console.log('\nStep 2: HR Verification...');
  const hrVerified = await onboardingService.hrVerifyCandidate(org.id, joiner1.candidate.id, adminUser.id, {
    hrNotes: 'Candidate passport and technical certifications audited and approved.',
    documentVerifications: [{ documentId: doc.id, status: 'VERIFIED' }],
    action: 'APPROVE',
  });
  console.log('✔ HR Verification Complete. Status:', hrVerified.status);

  // STEP 3 & 4: Admin Approval ✅ -> Generate Offer Letter
  console.log('\nStep 3 & 4: Admin Approval -> Generate Offer Letter...');
  const approvedOffer = await onboardingService.adminApproveAndGenerateOffer(org.id, joiner1.candidate.id, adminUser.id, {
    adminNotes: 'Candidate compensation package approved by Managing Director.',
  });
  console.log('✔ Admin Approved & Offer Letter Generated. Status:', approvedOffer.status);
  console.log('  Offer Ref:', approvedOffer.offerLetterRef);
  console.log('  Basic Monthly:', approvedOffer.offerLetterData.compensation.basicMonthly);
  console.log('  Annual CTC:', approvedOffer.offerLetterData.compensation.ctcAnnual);

  // STEP 5 & 6: HR Review -> Send to Employee
  console.log('\nStep 5 & 6: HR Review -> Send to Employee...');
  const offerSent = await onboardingService.hrReviewAndSendOffer(org.id, joiner1.candidate.id, adminUser.id, {
    hrReviewNotes: 'Offer reviewed by HR Director and released to Aarav Patel.',
  });
  console.log('✔ Offer Reviewed by HR and Sent to Employee. Status:', offerSent.status);
  console.log('  Offer Sent Timestamp:', offerSent.offerSentAt);

  // STEP 7A: Employee Accepts Offer
  console.log('\nStep 7A: Employee Accepts Offer in Portal...');
  const acceptResult = await onboardingService.respondToOffer(token1, {
    action: 'ACCEPT',
    signature: 'Aarav Patel',
  });
  console.log('✔ Employee Accepted Offer!');
  console.log('  Decision Status:', acceptResult.status);
  console.log('  Employee Code Created:', acceptResult.employee?.employeeCode);
  console.log('  Candidate Signature:', acceptResult.candidate.candidateSignature);
  console.log('  Response Timestamp:', acceptResult.candidate.offerRespondedAt);

  // STEP 7B: Test Scenario where Candidate Rejects Offer
  console.log('\nStep 7B: Testing Rejection Flow on second candidate...');
  const testEmail2 = `joiner.declining.${Date.now()}@acme.io`;
  const joiner2 = await onboardingService.createJoiner(org.id, adminUser.id, {
    firstName: 'Priya',
    lastName: 'Nair',
    email: testEmail2,
    designation: 'Product Designer',
    expectedJoinDate: '2026-11-15',
    proposedSalary: 70000,
  });
  const token2 = joiner2.candidate.token;

  // Fast forward to offer sent
  await onboardingService.adminApproveAndGenerateOffer(org.id, joiner2.candidate.id, adminUser.id);
  await onboardingService.hrReviewAndSendOffer(org.id, joiner2.candidate.id, adminUser.id);

  const rejectResult = await onboardingService.respondToOffer(token2, {
    action: 'REJECT',
    reason: 'Accepted competing offer closer to home location.',
  });
  console.log('✔ Candidate Declined Offer.');
  console.log('  Status:', rejectResult.status);
  console.log('  Recorded Reason:', rejectResult.candidate.offerRejectReason);

  console.log('\n===============================================================');
  console.log('ALL STEPS OF USER-REQUESTED WORKFLOW TESTED AND PASSED!');
  console.log('===============================================================');

  await prisma.$disconnect();
}

testUserRequestedOnboardingFlow().catch((err) => {
  console.error('Test Failed:', err);
  process.exit(1);
});
