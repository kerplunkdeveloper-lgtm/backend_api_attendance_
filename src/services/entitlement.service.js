const { PLAN_CONFIGS } = require("../config/plans");

function denied(message) {
  return Object.assign(new Error(message), { statusCode: 402 });
}
function assertEntitled(org, now = new Date()) {
  if (!org || org.deletedAt) throw denied("Organization is unavailable");
  const sub = org.subscription;
  const status = sub?.status || org.subscriptionStatus;
  const plan = sub?.plan || org.subscriptionPlan;
  const deadline = status === "TRIALING"
    ? org.trialEndsAt || sub?.trialEndsAt
    : org.subscriptionExpiresAt || sub?.currentPeriodEnd;
  // Cancellation preserves access only until the already-paid period ends.
  if (org.planLocked || !PLAN_CONFIGS[plan] || !["TRIALING", "ACTIVE", "CANCELED"].includes(status) ||
      !deadline || !Number.isFinite(new Date(deadline).getTime()) || new Date(deadline) <= now) {
    throw denied("Subscription expired or inactive. Open billing to renew your plan.");
  }
  return PLAN_CONFIGS[plan];
}
function assertFeature(org, feature) {
  const plan = assertEntitled(org);
  if (!plan[feature]) throw denied("This feature requires a different subscription plan");
}
module.exports = { assertEntitled, assertFeature };
