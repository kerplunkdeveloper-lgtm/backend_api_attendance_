-- CreateEnum
CREATE TYPE "SubscriptionPlan" AS ENUM ('FREE_TRIAL', 'STARTER', 'PROFESSIONAL', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "EmployeeDocumentType" AS ENUM ('AADHAAR', 'PAN', 'PASSPORT', 'DRIVING_LICENCE', 'EDUCATION_CERTIFICATE', 'EXPERIENCE_LETTER', 'OFFER_LETTER', 'EMPLOYMENT_CONTRACT', 'BANK_DOCUMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "ExitType" AS ENUM ('RESIGNATION', 'TERMINATION', 'RETIREMENT', 'MUTUAL_SEPARATION');

-- CreateEnum
CREATE TYPE "ExitStatus" AS ENUM ('RESIGNED', 'UNDER_HR_REVIEW', 'NOTICE_PERIOD', 'CLEARANCE_IN_PROGRESS', 'SETTLEMENT_CALCULATED', 'SETTLED', 'TERMINATED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "ClearanceDept" AS ENUM ('IT_ASSETS', 'REPORTING_MANAGER', 'FINANCE_PAYROLL', 'HR_OPERATIONS', 'ADMIN_FACILITY');

-- CreateEnum
CREATE TYPE "ClearanceItemStatus" AS ENUM ('PENDING', 'CLEARED', 'RECOVERABLE_DUE', 'WAIVED');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('DRAFT', 'APPROVED', 'DISBURSED');

-- CreateEnum
CREATE TYPE "AssetCategory" AS ENUM ('LAPTOP', 'DESKTOP', 'MONITOR', 'MOBILE_PHONE', 'TABLET', 'HEADPHONES_PERIPHERALS', 'SECURITY_TOKEN_KEY', 'OFFICE_FURNITURE', 'VEHICLE', 'OTHER');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('AVAILABLE', 'ASSIGNED', 'UNDER_MAINTENANCE', 'DAMAGED', 'RETIRED', 'LOST');

-- CreateEnum
CREATE TYPE "AssetCondition" AS ENUM ('NEW', 'EXCELLENT', 'GOOD', 'FAIR', 'DAMAGED');

-- CreateEnum
CREATE TYPE "AssetAssignmentType" AS ENUM ('ASSIGNMENT', 'RETURN', 'TRANSFER');

-- AlterTable
ALTER TABLE "AttendancePolicy" ALTER COLUMN "workingDaysPerMonth" SET DEFAULT 26;

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "avatarUrl" TEXT,
ADD COLUMN     "esiNumber" TEXT;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "maxEmployees" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "planActivatedAt" TIMESTAMP(3),
ADD COLUMN     "planLocked" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "subscriptionExpiresAt" TIMESTAMP(3),
ADD COLUMN     "subscriptionPlan" "SubscriptionPlan" NOT NULL DEFAULT 'FREE_TRIAL',
ADD COLUMN     "subscriptionStatus" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
ADD COLUMN     "trialEndsAt" TIMESTAMP(3),
ADD COLUMN     "unlockCode" TEXT,
ADD COLUMN     "unlockCodeUsedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Payslip" ADD COLUMN     "tdsDeduction" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Shift" ALTER COLUMN "workingDays" SET DEFAULT '1,2,3,4,5,6';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "avatarUrl" TEXT,
ADD COLUMN     "googleSub" TEXT,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "plan" "SubscriptionPlan" NOT NULL DEFAULT 'FREE_TRIAL',
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
    "billingCycle" TEXT NOT NULL DEFAULT 'MONTHLY',
    "price" DECIMAL(10,2) NOT NULL DEFAULT 0.0,
    "maxEmployees" INTEGER NOT NULL DEFAULT 10,
    "maxBranches" INTEGER NOT NULL DEFAULT 1,
    "hasGeofence" BOOLEAN NOT NULL DEFAULT true,
    "hasPayroll" BOOLEAN NOT NULL DEFAULT true,
    "hasShiftPlanner" BOOLEAN NOT NULL DEFAULT true,
    "hasApiAccess" BOOLEAN NOT NULL DEFAULT false,
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "trialEndsAt" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayslipTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Corporate Slate',
    "templateKey" TEXT NOT NULL DEFAULT 'MODERN_CORPORATE',
    "logoUrl" TEXT,
    "companyName" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "taxIdentifierLabel" TEXT DEFAULT 'CIN / GSTIN',
    "taxIdentifierValue" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "primaryColor" TEXT NOT NULL DEFAULT '#4f46e5',
    "accentColor" TEXT NOT NULL DEFAULT '#0f172a',
    "fontFamily" TEXT NOT NULL DEFAULT 'Inter',
    "headerLayout" TEXT NOT NULL DEFAULT 'SPLIT',
    "showBankDetails" BOOLEAN NOT NULL DEFAULT true,
    "showPanUan" BOOLEAN NOT NULL DEFAULT true,
    "showLeaveBalances" BOOLEAN NOT NULL DEFAULT true,
    "showAttendanceSummary" BOOLEAN NOT NULL DEFAULT true,
    "showOvertimeDetails" BOOLEAN NOT NULL DEFAULT true,
    "showNetSalaryInWords" BOOLEAN NOT NULL DEFAULT true,
    "showBarcodeOrQr" BOOLEAN NOT NULL DEFAULT true,
    "signatoryName" TEXT,
    "signatoryTitle" TEXT,
    "signatureImageUrl" TEXT,
    "declarationText" TEXT DEFAULT 'This is a computer-generated payslip and does not require a physical seal or signature.',
    "footerNotes" TEXT,
    "customHtml" TEXT,
    "customCss" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayslipTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeInvite" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT,
    "role" TEXT NOT NULL DEFAULT 'EMPLOYEE',
    "tempPassword" TEXT NOT NULL,
    "employeeId" TEXT,
    "userId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "invitedBy" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeDocument" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "documentType" "EmployeeDocumentType" NOT NULL,
    "title" TEXT,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileSize" INTEGER,
    "mimeType" TEXT,
    "status" "DocumentVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "rejectionReason" TEXT,
    "verifiedBy" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "expiryDate" DATE,
    "expiryReminderSent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeExit" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "exitType" "ExitType" NOT NULL DEFAULT 'RESIGNATION',
    "status" "ExitStatus" NOT NULL DEFAULT 'RESIGNED',
    "resignationDate" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "preferredLastWorkingDate" DATE,
    "approvedLastWorkingDate" DATE,
    "noticePeriodDays" INTEGER NOT NULL DEFAULT 30,
    "isNoticeWaived" BOOLEAN NOT NULL DEFAULT false,
    "waivedNoticeDays" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT NOT NULL,
    "employeeComments" TEXT,
    "hrNotes" TEXT,
    "hrReviewerId" TEXT,
    "hrReviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeExit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeClearance" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "exitId" TEXT NOT NULL,
    "department" "ClearanceDept" NOT NULL,
    "itemName" TEXT NOT NULL,
    "itemDescription" TEXT,
    "status" "ClearanceItemStatus" NOT NULL DEFAULT 'PENDING',
    "recoveryAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "clearedBy" TEXT,
    "clearedAt" TIMESTAMP(3),
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeClearance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExitInterview" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "exitId" TEXT NOT NULL,
    "reasonCategory" TEXT,
    "feedbackRatings" JSONB,
    "whatWeDidWell" TEXT,
    "whatCanWeImprove" TEXT,
    "wouldRecommendCompany" BOOLEAN NOT NULL DEFAULT true,
    "conductedBy" TEXT,
    "conductedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExitInterview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinalSettlement" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "exitId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "workedDaysInFinalMonth" DECIMAL(5,1) NOT NULL DEFAULT 0,
    "finalSalaryPayable" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "overtimePay" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "leaveEncashmentDays" DECIMAL(5,1) NOT NULL DEFAULT 0,
    "leaveEncashmentAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "pendingReimbursements" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "gratuityOrBonus" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "otherEarnings" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "lopDays" DECIMAL(5,1) NOT NULL DEFAULT 0,
    "lopDeduction" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "noticeShortfallDays" DECIMAL(5,1) NOT NULL DEFAULT 0,
    "noticeShortfallDeduction" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "assetRecoveryAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "loanOrAdvanceRecovery" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "statutoryDeductions" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "otherDeductions" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "grossEarnings" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "totalDeductions" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "netPayable" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "status" "SettlementStatus" NOT NULL DEFAULT 'DRAFT',
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "disbursedAt" TIMESTAMP(3),
    "paymentReference" TEXT,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinalSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "assetCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "AssetCategory" NOT NULL DEFAULT 'LAPTOP',
    "brand" TEXT,
    "modelNumber" TEXT,
    "serialNumber" TEXT,
    "purchaseDate" DATE,
    "purchaseCost" DECIMAL(10,2),
    "warrantyExpiry" DATE,
    "status" "AssetStatus" NOT NULL DEFAULT 'AVAILABLE',
    "condition" "AssetCondition" NOT NULL DEFAULT 'NEW',
    "specifications" JSONB,
    "assignedToId" TEXT,
    "assignedDate" TIMESTAMP(3),
    "assignedCondition" "AssetCondition",
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetAssignment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "type" "AssetAssignmentType" NOT NULL DEFAULT 'ASSIGNMENT',
    "employeeId" TEXT,
    "fromEmployeeId" TEXT,
    "assignedDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "returnedDate" TIMESTAMP(3),
    "conditionOnAssign" "AssetCondition" NOT NULL DEFAULT 'GOOD',
    "conditionOnReturn" "AssetCondition",
    "assignedBy" TEXT,
    "returnedTo" TEXT,
    "recoveryCharge" DECIMAL(10,2),
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetMaintenance" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "issueDescription" TEXT NOT NULL,
    "vendorName" TEXT,
    "cost" DECIMAL(10,2),
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssetMaintenance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItDeclaration" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "financialYear" TEXT NOT NULL,
    "regime" TEXT NOT NULL DEFAULT 'NEW',
    "rentPaidAnnual" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "isMetro" BOOLEAN NOT NULL DEFAULT true,
    "section80C" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "section80D" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "homeLoanInterest" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "npsEmployee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "otherExemptions" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "previousEmployerIncome" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "previousEmployerTds" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItDeclaration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Form16Record" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "financialYear" TEXT NOT NULL,
    "regime" TEXT NOT NULL,
    "grossSalary" DECIMAL(12,2) NOT NULL,
    "exemptions" DECIMAL(12,2) NOT NULL,
    "standardDeduction" DECIMAL(12,2) NOT NULL,
    "taxableIncome" DECIMAL(12,2) NOT NULL,
    "taxOnIncome" DECIMAL(12,2) NOT NULL,
    "rebate87A" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "cess" DECIMAL(12,2) NOT NULL,
    "totalTax" DECIMAL(12,2) NOT NULL,
    "tdsDeducted" DECIMAL(12,2) NOT NULL,
    "taxPayable" DECIMAL(12,2) NOT NULL,
    "html" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Form16Record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatutoryExport" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "fileName" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT,

    CONSTRAINT "StatutoryExport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingOrder" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "billingCycle" TEXT NOT NULL,
    "amountInr" DECIMAL(12,2) NOT NULL,
    "razorpayOrderId" TEXT,
    "razorpayPaymentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "BillingOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatThread" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT,
    "isDirect" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMember" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3),

    CONSTRAINT "ChatMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "senderUserId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BiometricDevice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT,
    "apiKeyHash" TEXT NOT NULL,
    "apiKeyPrefix" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BiometricDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoanAdvance" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'ADVANCE',
    "amount" DECIMAL(12,2) NOT NULL,
    "monthlyRecovery" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "outstanding" DECIMAL(12,2) NOT NULL,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewedByUserId" TEXT,
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoanAdvance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppraisalCycle" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppraisalCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppraisalReview" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "reviewerUserId" TEXT,
    "selfScore" INTEGER,
    "managerScore" INTEGER,
    "selfComments" TEXT,
    "managerComments" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppraisalReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgApiKey" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_organizationId_key" ON "Subscription"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "PayslipTemplate_organizationId_key" ON "PayslipTemplate"("organizationId");

-- CreateIndex
CREATE INDEX "EmployeeInvite_organizationId_status_idx" ON "EmployeeInvite"("organizationId", "status");

-- CreateIndex
CREATE INDEX "EmployeeInvite_email_idx" ON "EmployeeInvite"("email");

-- CreateIndex
CREATE INDEX "EmployeeDocument_organizationId_idx" ON "EmployeeDocument"("organizationId");

-- CreateIndex
CREATE INDEX "EmployeeDocument_employeeId_idx" ON "EmployeeDocument"("employeeId");

-- CreateIndex
CREATE INDEX "EmployeeDocument_documentType_idx" ON "EmployeeDocument"("documentType");

-- CreateIndex
CREATE INDEX "EmployeeDocument_expiryDate_idx" ON "EmployeeDocument"("expiryDate");

-- CreateIndex
CREATE INDEX "EmployeeExit_organizationId_status_idx" ON "EmployeeExit"("organizationId", "status");

-- CreateIndex
CREATE INDEX "EmployeeExit_employeeId_idx" ON "EmployeeExit"("employeeId");

-- CreateIndex
CREATE INDEX "EmployeeClearance_organizationId_idx" ON "EmployeeClearance"("organizationId");

-- CreateIndex
CREATE INDEX "EmployeeClearance_exitId_idx" ON "EmployeeClearance"("exitId");

-- CreateIndex
CREATE INDEX "EmployeeClearance_department_idx" ON "EmployeeClearance"("department");

-- CreateIndex
CREATE UNIQUE INDEX "ExitInterview_exitId_key" ON "ExitInterview"("exitId");

-- CreateIndex
CREATE INDEX "ExitInterview_organizationId_idx" ON "ExitInterview"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "FinalSettlement_exitId_key" ON "FinalSettlement"("exitId");

-- CreateIndex
CREATE INDEX "FinalSettlement_organizationId_status_idx" ON "FinalSettlement"("organizationId", "status");

-- CreateIndex
CREATE INDEX "FinalSettlement_employeeId_idx" ON "FinalSettlement"("employeeId");

-- CreateIndex
CREATE INDEX "Asset_organizationId_category_idx" ON "Asset"("organizationId", "category");

-- CreateIndex
CREATE INDEX "Asset_organizationId_status_idx" ON "Asset"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Asset_assignedToId_idx" ON "Asset"("assignedToId");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_organizationId_assetCode_key" ON "Asset"("organizationId", "assetCode");

-- CreateIndex
CREATE INDEX "AssetAssignment_organizationId_idx" ON "AssetAssignment"("organizationId");

-- CreateIndex
CREATE INDEX "AssetAssignment_assetId_idx" ON "AssetAssignment"("assetId");

-- CreateIndex
CREATE INDEX "AssetAssignment_employeeId_idx" ON "AssetAssignment"("employeeId");

-- CreateIndex
CREATE INDEX "AssetMaintenance_organizationId_idx" ON "AssetMaintenance"("organizationId");

-- CreateIndex
CREATE INDEX "AssetMaintenance_assetId_idx" ON "AssetMaintenance"("assetId");

-- CreateIndex
CREATE INDEX "ItDeclaration_organizationId_financialYear_idx" ON "ItDeclaration"("organizationId", "financialYear");

-- CreateIndex
CREATE UNIQUE INDEX "ItDeclaration_employeeId_financialYear_key" ON "ItDeclaration"("employeeId", "financialYear");

-- CreateIndex
CREATE INDEX "Form16Record_organizationId_financialYear_idx" ON "Form16Record"("organizationId", "financialYear");

-- CreateIndex
CREATE UNIQUE INDEX "Form16Record_employeeId_financialYear_key" ON "Form16Record"("employeeId", "financialYear");

-- CreateIndex
CREATE INDEX "StatutoryExport_organizationId_type_year_month_idx" ON "StatutoryExport"("organizationId", "type", "year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "BillingOrder_razorpayOrderId_key" ON "BillingOrder"("razorpayOrderId");

-- CreateIndex
CREATE INDEX "BillingOrder_organizationId_status_idx" ON "BillingOrder"("organizationId", "status");

-- CreateIndex
CREATE INDEX "ChatThread_organizationId_updatedAt_idx" ON "ChatThread"("organizationId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChatMember_threadId_userId_key" ON "ChatMember"("threadId", "userId");

-- CreateIndex
CREATE INDEX "ChatMessage_threadId_createdAt_idx" ON "ChatMessage"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "ChatMessage_organizationId_idx" ON "ChatMessage"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "BiometricDevice_apiKeyHash_key" ON "BiometricDevice"("apiKeyHash");

-- CreateIndex
CREATE INDEX "BiometricDevice_organizationId_idx" ON "BiometricDevice"("organizationId");

-- CreateIndex
CREATE INDEX "LoanAdvance_organizationId_status_idx" ON "LoanAdvance"("organizationId", "status");

-- CreateIndex
CREATE INDEX "LoanAdvance_employeeId_idx" ON "LoanAdvance"("employeeId");

-- CreateIndex
CREATE INDEX "AppraisalCycle_organizationId_status_idx" ON "AppraisalCycle"("organizationId", "status");

-- CreateIndex
CREATE INDEX "AppraisalReview_organizationId_idx" ON "AppraisalReview"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "AppraisalReview_cycleId_employeeId_key" ON "AppraisalReview"("cycleId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "OrgApiKey_keyHash_key" ON "OrgApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "OrgApiKey_organizationId_idx" ON "OrgApiKey"("organizationId");

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayslipTemplate" ADD CONSTRAINT "PayslipTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeInvite" ADD CONSTRAINT "EmployeeInvite_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeDocument" ADD CONSTRAINT "EmployeeDocument_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeDocument" ADD CONSTRAINT "EmployeeDocument_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeExit" ADD CONSTRAINT "EmployeeExit_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeExit" ADD CONSTRAINT "EmployeeExit_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeClearance" ADD CONSTRAINT "EmployeeClearance_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeClearance" ADD CONSTRAINT "EmployeeClearance_exitId_fkey" FOREIGN KEY ("exitId") REFERENCES "EmployeeExit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExitInterview" ADD CONSTRAINT "ExitInterview_exitId_fkey" FOREIGN KEY ("exitId") REFERENCES "EmployeeExit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinalSettlement" ADD CONSTRAINT "FinalSettlement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinalSettlement" ADD CONSTRAINT "FinalSettlement_exitId_fkey" FOREIGN KEY ("exitId") REFERENCES "EmployeeExit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinalSettlement" ADD CONSTRAINT "FinalSettlement_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetAssignment" ADD CONSTRAINT "AssetAssignment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetAssignment" ADD CONSTRAINT "AssetAssignment_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetAssignment" ADD CONSTRAINT "AssetAssignment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetMaintenance" ADD CONSTRAINT "AssetMaintenance_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetMaintenance" ADD CONSTRAINT "AssetMaintenance_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItDeclaration" ADD CONSTRAINT "ItDeclaration_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItDeclaration" ADD CONSTRAINT "ItDeclaration_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Form16Record" ADD CONSTRAINT "Form16Record_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Form16Record" ADD CONSTRAINT "Form16Record_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatutoryExport" ADD CONSTRAINT "StatutoryExport_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingOrder" ADD CONSTRAINT "BillingOrder_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatThread" ADD CONSTRAINT "ChatThread_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMember" ADD CONSTRAINT "ChatMember_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "ChatThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMember" ADD CONSTRAINT "ChatMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "ChatThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BiometricDevice" ADD CONSTRAINT "BiometricDevice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanAdvance" ADD CONSTRAINT "LoanAdvance_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanAdvance" ADD CONSTRAINT "LoanAdvance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppraisalCycle" ADD CONSTRAINT "AppraisalCycle_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppraisalReview" ADD CONSTRAINT "AppraisalReview_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppraisalReview" ADD CONSTRAINT "AppraisalReview_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "AppraisalCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppraisalReview" ADD CONSTRAINT "AppraisalReview_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgApiKey" ADD CONSTRAINT "OrgApiKey_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
