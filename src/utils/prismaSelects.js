/** Scalars that exist on Neon today. Prisma schema also has address/taxId/logoUrl. */
const organizationSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  timezone: true,
  currency: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  subscriptionPlan: true,
  subscriptionStatus: true,
  trialEndsAt: true,
  subscriptionExpiresAt: true,
  maxEmployees: true,
  // unlockCode (a bcrypt hash) is deliberately absent: this select is spread
  // into /auth/me responses. Plan activation reads it with its own query.
  unlockCodeUsedAt: true,
  planActivatedAt: true,
  planLocked: true,
  logoUrl: true,
  suspendedAt: true,
  requireAdminTwoFactor: true,
  subscription: { select: { id: true, organizationId: true, plan: true, status: true, billingCycle: true, price: true, maxEmployees: true, maxBranches: true, hasGeofence: true, hasPayroll: true, hasShiftPlanner: true, hasApiAccess: true, startDate: true, trialEndsAt: true, currentPeriodEnd: true, createdAt: true, updatedAt: true } },
};

const organizationWithSubscription = { select: organizationSelect };

const policySelect = {
  id: true,
  organizationId: true,
  workingDaysPerMonth: true,
  probationMonths: true,
  monthlyPermissionHours: true,
  permissionRequiresProbation: true,
  payrollCycleStartDay: true,
  payrollCycleEndDay: true,
  payrollDayBasis: true,
  halfDayThresholdMinutes: true,
  maxLatesBeforeDeduction: true,
  lateDeductionPercent: true,
  allowWfh: true,
  requireOtApproval: true,
  geofenceStrict: true,
  weeklyOffDays: true,
  createdAt: true,
  updatedAt: true,
};

/** Opt back in to the user secrets that the client omits by default (see config/database.js). */
const WITH_SECRETS = { passwordHash: false, twoFactorSecret: false, twoFactorBackupCodes: false, twoFactorLastStep: false, emailVerificationCodeHash: false };

module.exports = {
  WITH_SECRETS,
  organizationSelect,
  organizationWithSubscription,
  policySelect,
};
