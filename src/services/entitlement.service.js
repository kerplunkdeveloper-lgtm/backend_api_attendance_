const prisma = require("../config/database");
const { SEAT_STATUSES, getPlan } = require("../config/plans");

const GRACE_MS = 3 * 24 * 60 * 60 * 1000;
const TRIAL_GRACE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days grace after trial ends

const periodEndOf = (org) =>
  org?.subscription?.currentPeriodEnd ||
  org?.subscriptionExpiresAt ||
  org?.trialEndsAt ||
  null;

const evaluateEntitlement = (org, now = new Date()) => {
  if (!org) {
    return {
      state: "MISSING",
      allowApp: false,
      code: "ORG_MISSING",
      message: "Organization is not available.",
    };
  }

  if (org.deletedAt) {
    return {
      state: "INACTIVE",
      allowApp: false,
      code: "ORG_INACTIVE",
      message: "This organization is no longer active.",
    };
  }

  if (org.suspendedAt) {
    return {
      state: "SUSPENDED",
      allowApp: false,
      code: "ACCOUNT_SUSPENDED",
      message: "This workspace has been suspended. Please contact WorkPulse support.",
    };
  }

  const nowMs = now.getTime();
  const status = String(org.subscription?.status || org.subscriptionStatus || "TRIALING").toUpperCase();
  const expiresAt = periodEndOf(org);
  const expiryMs = expiresAt ? new Date(expiresAt).getTime() : null;
  const trialEnd = org.trialEndsAt || (status === "TRIALING" ? expiresAt : null);
  const trialMs = trialEnd ? new Date(trialEnd).getTime() : null;

  if (status === "TRIALING") {
    // If no trial end date is set, org is always in trial — allow access
    if (!trialMs) {
      return { state: "TRIAL", allowApp: true, code: "TRIALING" };
    }
    if (nowMs > trialMs) {
      // 7-day grace window after trial expires before hard-blocking
      if (nowMs <= trialMs + TRIAL_GRACE_MS) {
        return { state: "TRIAL_GRACE", allowApp: true, code: "TRIAL_GRACE" };
      }
      return {
        state: "EXPIRED",
        allowApp: false,
        code: "TRIAL_EXPIRED",
        message: "Your trial has ended. Choose a plan to continue.",
      };
    }
    return { state: "TRIAL", allowApp: true, code: "TRIALING" };
  }

  if (status === "ACTIVE") {
    if (expiryMs && nowMs > expiryMs + GRACE_MS) {
      return {
        state: "EXPIRED",
        allowApp: false,
        code: "SUBSCRIPTION_EXPIRED",
        message: "Your subscription has expired. Renew to continue.",
      };
    }
    if (expiryMs && nowMs > expiryMs) {
      return { state: "GRACE", allowApp: true, code: "GRACE" };
    }
    return { state: "ACTIVE", allowApp: true, code: "ACTIVE" };
  }

  if (status === "CANCELED") {
    if (expiryMs && nowMs <= expiryMs) {
      return { state: "CANCELED_ACTIVE", allowApp: true, code: "CANCELED" };
    }
    return {
      state: "CANCELED",
      allowApp: false,
      code: "SUBSCRIPTION_CANCELED",
      message: "This subscription is canceled. Update billing to restore access.",
    };
  }

  if (status === "PAST_DUE") {
    if (expiryMs && nowMs <= expiryMs + GRACE_MS) {
      return { state: "PAST_DUE", allowApp: true, code: "PAST_DUE" };
    }
    return {
      state: "PAST_DUE",
      allowApp: false,
      code: "PAYMENT_REQUIRED",
      message: "Payment is required before this workspace can be used.",
    };
  }

  if (status === "EXPIRED") {
    return {
      state: "EXPIRED",
      allowApp: false,
      code: "SUBSCRIPTION_EXPIRED",
      message: "Your subscription has expired. Renew to continue.",
    };
  }

  // Unknown/unrecognized status — allow access by default
  return { state: status, allowApp: true, code: status };
};

const recoveryPathRe =
  /^\/(api\/)?(health|ready|db-status)(\/|$)|^\/(api\/)?auth\/(me|login|register|google|refresh-token|refresh|logout|forgot-password|reset-password|change-password|activate-plan|plans|upgrade-plan)|^\/(api\/)?billing(\/|$)/;

const isRecoveryPath = (req) => {
  const path = String(req?.originalUrl || req?.path || "").split("?")[0];
  return recoveryPathRe.test(path);
};

const resolveLimits = (org) => {
  const plan = getPlan(org?.subscription?.plan || org?.subscriptionPlan) || getPlan("FREE_TRIAL");
  return {
    maxEmployees: org?.subscription?.maxEmployees || org?.maxEmployees || plan.maxEmployees,
    maxBranches: org?.subscription?.maxBranches || plan.maxBranches,
    hasPayroll: org?.subscription?.hasPayroll ?? plan.hasPayroll,
    hasApiAccess: org?.subscription?.hasApiAccess ?? plan.hasApiAccess,
    hasGeofence: org?.subscription?.hasGeofence ?? plan.hasGeofence,
    hasShiftPlanner: org?.subscription?.hasShiftPlanner ?? plan.hasShiftPlanner,
  };
};

const countSeats = (organizationId, client = prisma) =>
  client.employee.count({
    where: {
      organizationId,
      deletedAt: null,
      status: { in: SEAT_STATUSES },
    },
  });

const assertSeatAvailable = async (organizationId, client = prisma) => {
  if (typeof client.$queryRaw === "function") {
    await client.$queryRaw`SELECT id FROM "Organization" WHERE id = ${organizationId} FOR UPDATE`;
  }
  const org = await client.organization.findUnique({
    where: { id: organizationId },
    include: { subscription: true },
  });
  if (!org) {
    const err = new Error("Organization not found.");
    err.statusCode = 404;
    throw err;
  }
  if (org.planLocked) {
    const err = new Error("Your plan is locked. Activate or complete payment before adding employees.");
    err.statusCode = 403;
    throw err;
  }
  const entitlement = evaluateEntitlement(org);
  if (!entitlement.allowApp) {
    const err = new Error(entitlement.message);
    err.statusCode = 402;
    err.code = entitlement.code;
    throw err;
  }
  const limits = resolveLimits(org);
  const used = await countSeats(organizationId, client);
  if (used >= limits.maxEmployees) {
    const err = new Error(
      `Employee limit reached for your current plan (${limits.maxEmployees} max seats). Upgrade to add more team members.`,
    );
    err.statusCode = 403;
    throw err;
  }
  return { org, used, maxEmployees: limits.maxEmployees };
};

const assertBranchAvailable = async (organizationId, client = prisma) => {
  if (typeof client.$queryRaw === "function") {
    await client.$queryRaw`SELECT id FROM "Organization" WHERE id = ${organizationId} FOR UPDATE`;
  }
  const org = await client.organization.findUnique({
    where: { id: organizationId },
    include: { subscription: true },
  });
  if (!org) {
    const err = new Error("Organization not found.");
    err.statusCode = 404;
    throw err;
  }
  const entitlement = evaluateEntitlement(org);
  if (!entitlement.allowApp) {
    const err = new Error(entitlement.message);
    err.statusCode = 402;
    err.code = entitlement.code;
    throw err;
  }
  const limits = resolveLimits(org);
  const used = await client.branch.count({ where: { organizationId } });
  if (used >= limits.maxBranches) {
    const err = new Error(
      `Branch limit reached for your current plan (${limits.maxBranches} max). Upgrade to add more locations.`,
    );
    err.statusCode = 403;
    throw err;
  }
  return { org, used, maxBranches: limits.maxBranches };
};

const assertFeature = (org, flag, label) => {
  const limits = resolveLimits(org || {});
  if (!limits[flag]) {
    const err = new Error(`${label} is not included in your current plan.`);
    err.statusCode = 403;
    err.code = "FEATURE_LOCKED";
    throw err;
  }
};

const presentAuthUser = (user) => {
  const org = user?.organization || null;
  const entitlement = evaluateEntitlement(org);
  const features = resolveLimits(org || {});
  const expiresAt = periodEndOf(org);
  const daysRemaining = expiresAt
    ? Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86400000))
    : null;
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    organizationId: user.organizationId,
    organization: org
      ? {
          ...org,
          subscriptionPlan: org.subscription?.plan || org.subscriptionPlan,
          subscriptionStatus: org.subscription?.status || org.subscriptionStatus,
          subscriptionExpiresAt:
            org.subscription?.currentPeriodEnd || org.subscriptionExpiresAt,
          maxEmployees: features.maxEmployees,
        }
      : null,
    employee: user.employee || null,
    avatarUrl: user.avatarUrl || user.employee?.avatarUrl || null,
    planLocked: org?.planLocked ?? false,
    mustChangePassword: user.mustChangePassword ?? false,
    entitlement: {
      state: entitlement.state,
      allowApp: entitlement.allowApp,
      code: entitlement.code,
      message: entitlement.message || null,
      daysRemaining,
      expiresAt,
    },
    features,
  };
};

module.exports = {
  evaluateEntitlement,
  isRecoveryPath,
  resolveLimits,
  countSeats,
  assertSeatAvailable,
  assertBranchAvailable,
  assertFeature,
  presentAuthUser,
  SEAT_STATUSES,
};
