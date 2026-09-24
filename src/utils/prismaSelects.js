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
  unlockCode: true,
  unlockCodeUsedAt: true,
  planActivatedAt: true,
  planLocked: true,
  subscription: true,
};

const organizationWithSubscription = { select: organizationSelect };

const policySelect = {
  id: true,
  organizationId: true,
  workingDaysPerMonth: true,
  halfDayThresholdMinutes: true,
  maxLatesBeforeDeduction: true,
  lateDeductionPercent: true,
  allowWfh: true,
  requireOtApproval: true,
  geofenceStrict: true,
  createdAt: true,
  updatedAt: true,
};

module.exports = {
  organizationSelect,
  organizationWithSubscription,
  policySelect,
};
