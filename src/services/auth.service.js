const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const prisma = require("../config/database");
const {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
} = require("../utils/jwt");
const emailService = require("./email.service");

const SUBSCRIPTION_PLANS = [
  {
    id: "FREE_TRIAL",
    name: "Free Trial",
    badge: "14-Day Free Trial",
    priceMonthly: 0,
    priceAnnual: 0,
    currency: "USD",
    maxEmployees: 10,
    maxBranches: 1,
    description: "Full access to try WorkPulse with your core team for 14 days.",
    features: [
      "Up to 10 Employees",
      "1 Branch Location",
      "GPS Geofenced Punching",
      "Live Attendance Tracking",
      "Leave Management",
      "Standard Shift Schedules",
      "Community Support",
    ],
    popular: false,
  },
  {
    id: "STARTER",
    name: "Starter",
    badge: "For Growing Teams",
    priceMonthly: 29,
    priceAnnual: 24,
    currency: "USD",
    maxEmployees: 25,
    maxBranches: 2,
    description: "Essential attendance, geofencing, and leave management for small businesses.",
    features: [
      "Up to 25 Employees",
      "2 Branch Locations",
      "GPS Geofencing & Anti-Spoof",
      "Leave & Holiday Management",
      "Miss-Punch Regularization",
      "Basic Payslip Generation",
      "Email Support",
    ],
    popular: false,
  },
  {
    id: "PROFESSIONAL",
    name: "Professional",
    badge: "Most Popular",
    priceMonthly: 79,
    priceAnnual: 64,
    currency: "USD",
    maxEmployees: 100,
    maxBranches: 10,
    description: "Complete workforce platform with shift overrides, comp-off, overtime, and payroll.",
    features: [
      "Up to 100 Employees",
      "10 Branch Locations",
      "Shift Scheduling & Day Overrides",
      "Overtime Approval Gateways",
      "Comp-Off Balance Ledger",
      "Full Automated Payroll Engine",
      "Device Binding & Geofence Bypass Audit",
      "Priority 24/7 Support",
    ],
    popular: true,
  },
  {
    id: "ENTERPRISE",
    name: "Enterprise",
    badge: "For Large Organizations",
    priceMonthly: 199,
    priceAnnual: 160,
    currency: "USD",
    maxEmployees: 1000,
    maxBranches: 50,
    description: "Unlimited power, dedicated infrastructure, custom policies, and REST API access.",
    features: [
      "Unlimited Employees (up to 1,000+)",
      "Unlimited Branch Locations",
      "Custom Org Policy Engine",
      "Biometric Hardware Integration",
      "Dedicated REST API Access",
      "Custom RBAC Roles & Permissions",
      "Dedicated Account Manager",
      "99.9% Uptime SLA",
    ],
    popular: false,
  },
];

const PLAN_CONFIGS = {
  FREE_TRIAL: {
    plan: "FREE_TRIAL",
    status: "TRIALING",
    price: 0,
    maxEmployees: 10,
    maxBranches: 1,
    trialDays: 14,
    hasGeofence: true,
    hasPayroll: true,
    hasShiftPlanner: true,
    hasApiAccess: false,
  },
  STARTER: {
    plan: "STARTER",
    status: "ACTIVE",
    price: 29,
    maxEmployees: 25,
    maxBranches: 2,
    periodDays: 30,
    hasGeofence: true,
    hasPayroll: true,
    hasShiftPlanner: true,
    hasApiAccess: false,
  },
  PROFESSIONAL: {
    plan: "PROFESSIONAL",
    status: "ACTIVE",
    price: 79,
    maxEmployees: 100,
    maxBranches: 10,
    periodDays: 30,
    hasGeofence: true,
    hasPayroll: true,
    hasShiftPlanner: true,
    hasApiAccess: true,
  },
  ENTERPRISE: {
    plan: "ENTERPRISE",
    status: "ACTIVE",
    price: 199,
    maxEmployees: 1000,
    maxBranches: 50,
    periodDays: 30,
    hasGeofence: true,
    hasPayroll: true,
    hasShiftPlanner: true,
    hasApiAccess: true,
  },
};

const register = async ({
  email,
  password,
  organizationName,
  organizationId,
  firstName,
  lastName,
  role,
  employeeCode,
  subscriptionPlan,
  billingCycle,
}) => {
  const cleanEmail = email.trim().toLowerCase();

  const existingUser = await prisma.user.findFirst({
    where: {
      email: { equals: cleanEmail, mode: "insensitive" },
    },
  });

  if (existingUser) {
    throw new Error("User with this email already exists");
  }

  // Determine subscription plan configuration
  const chosenPlanKey = (subscriptionPlan || "FREE_TRIAL").toUpperCase();
  const planMeta = PLAN_CONFIGS[chosenPlanKey] || PLAN_CONFIGS.FREE_TRIAL;
  const cycle = (billingCycle || "MONTHLY").toUpperCase() === "ANNUAL" ? "ANNUAL" : "MONTHLY";

  const now = new Date();
  const trialEndsAt = planMeta.trialDays ? new Date(now.getTime() + planMeta.trialDays * 24 * 60 * 60 * 1000) : null;
  const periodDays = cycle === "ANNUAL" ? 365 : 30;
  const currentPeriodEnd = new Date(now.getTime() + periodDays * 24 * 60 * 60 * 1000);
  const calculatedPrice = cycle === "ANNUAL" ? planMeta.price * 10 : planMeta.price;

  let finalOrgId = organizationId;

  if (finalOrgId) {
    const existingOrg = await prisma.organization.findUnique({
      where: { id: finalOrgId },
    });
    if (!existingOrg) {
      throw new Error("Specified organization not found");
    }
  } else {
    const org = await prisma.organization.create({
      data: {
        name: organizationName || "Default Organization",
        subscriptionPlan: planMeta.plan,
        subscriptionStatus: planMeta.status,
        trialEndsAt,
        subscriptionExpiresAt: planMeta.plan === "FREE_TRIAL" ? trialEndsAt : currentPeriodEnd,
        maxEmployees: planMeta.maxEmployees,
        planLocked: true, // locked until admin enters the unlock code
        subscription: {
          create: {
            plan: planMeta.plan,
            status: planMeta.status,
            billingCycle: cycle,
            price: calculatedPrice,
            maxEmployees: planMeta.maxEmployees,
            maxBranches: planMeta.maxBranches,
            hasGeofence: planMeta.hasGeofence,
            hasPayroll: planMeta.hasPayroll,
            hasShiftPlanner: planMeta.hasShiftPlanner,
            hasApiAccess: planMeta.hasApiAccess,
            trialEndsAt,
            currentPeriodEnd,
          },
        },
      },
    });
    finalOrgId = org.id;
  }

  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(password, salt);

  // Generate a readable plan unlock code: WP-XXXX-XXXX-XXXX
  const rawCode = [
    crypto.randomBytes(2).toString("hex").toUpperCase(),
    crypto.randomBytes(2).toString("hex").toUpperCase(),
    crypto.randomBytes(2).toString("hex").toUpperCase(),
  ].join("-");
  const unlockCode = `WP-${rawCode}`;
  const unlockCodeHash = await bcrypt.hash(unlockCode, 10);

  // Store hashed code on org
  await prisma.organization.update({
    where: { id: finalOrgId },
    data: { unlockCode: unlockCodeHash },
  });

  const finalRole = role || "COMPANY_ADMIN";

  const user = await prisma.user.create({
    data: {
      email: cleanEmail,
      passwordHash,
      role: finalRole,
      organizationId: finalOrgId,
      ...(firstName
        ? {
            employee: {
              create: {
                organizationId: finalOrgId,
                employeeCode:
                  employeeCode || `EMP-${Date.now().toString().slice(-6)}`,
                firstName,
                lastName: lastName || null,
              },
            },
          }
        : {}),
    },
    include: {
      organization: {
        include: {
          subscription: true,
        },
      },
         employee: true,
    },
  });

  const tokenPayload = {
    userId: user.id,
    organizationId: user.organizationId,
    role: user.role,
  };

  const accessToken = generateAccessToken(tokenPayload);
  const refreshToken = generateRefreshToken(tokenPayload);

  // Store refresh token in DB for revocation support
  const regTokenExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await prisma.refreshToken.create({
    data: { userId: user.id, token: refreshToken, expiresAt: regTokenExpiresAt },
  });

  // Send unlock code to admin email (async — don't block registration)
  const loginUrl = `${process.env.FRONTEND_URL || "http://localhost:3000"}/login`;
  emailService.sendUnlockCodeEmail(
    cleanEmail,
    firstName || "Admin",
    {
      organizationName: organizationName || "Your Organization",
      unlockCode,         // plaintext — only sent once in this email
      plan: planMeta.plan,
      loginUrl,
    }
  ).catch((err) => console.warn("[Register] Unlock code email failed:", err.message));

  // Log unlock code to console for dev / simulation mode
  console.log("────────────────────────────────────────────────────────────");
  console.log(`[Register] Organization: ${organizationName || "Default Organization"}`);
  console.log(`[Register] Admin Email : ${cleanEmail}`);
  console.log(`[Register] UNLOCK CODE : ${unlockCode}`);
  console.log("────────────────────────────────────────────────────────────");

  return {
    accessToken,
    refreshToken,
    token: accessToken,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId,
      organization: user.organization,
      employee: user.employee,
      planLocked: true,
      mustChangePassword: false,
    },
  };
};


const login = async (email, password, client = null) => {
  const cleanEmail = email ? email.trim().toLowerCase() : "";

  const user = await prisma.user.findFirst({
    where: {
      email: { equals: cleanEmail, mode: "insensitive" },
    },
    include: {
      organization: {
        include: {
          subscription: true,
        },
      },
      employee: {
        include: {
          branch: true,
          shift: true,
          department: true,
        },
      },
    },
  });

  if (!user) {
    throw new Error("Invalid email or password");
  }

  const passwordValid = await bcrypt.compare(password, user.passwordHash);

  if (!passwordValid) {
    throw new Error("Invalid email or password");
  }

  // Web access restriction: Only Admins and Managers can use the web app. Employees must use mobile app.
  if (client === "web" && user.role === "EMPLOYEE") {
    const error = new Error(
      "Web application access is reserved for Administrators and Managers. Please sign in via the WorkPulse Mobile App to clock in and manage attendance."
    );
    error.statusCode = 403;
    error.code = "MOBILE_APP_REQUIRED";
    throw error;
  }

  const tokenPayload = {
    userId: user.id,
    organizationId: user.organizationId,
    role: user.role,
  };

  const accessToken = generateAccessToken(tokenPayload);
  const refreshToken = generateRefreshToken(tokenPayload);

  // Store refresh token in DB for revocation support
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await prisma.refreshToken.create({
    data: { userId: user.id, token: refreshToken, expiresAt },
  });

  return {
    accessToken,
    refreshToken,
    token: accessToken,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId,
      organization: user.organization,
      employee: user.employee,
      planLocked: user.organization?.planLocked ?? false,
      mustChangePassword: user.mustChangePassword ?? false,
    },
  };
};


const refreshAccessToken = async (refreshToken) => {
  if (!refreshToken) throw new Error("Refresh token is required");

  let decoded;
  try {
    decoded = verifyRefreshToken(refreshToken);
  } catch (err) {
    throw new Error("Invalid or expired refresh token");
  }

  if (!decoded?.userId) throw new Error("Invalid token payload");

  // Validate token exists in DB (not revoked via logout)
  const storedToken = await prisma.refreshToken.findUnique({
    where: { token: refreshToken },
  });
  if (!storedToken) throw new Error("Refresh token has been revoked. Please log in again.");
  if (storedToken.expiresAt < new Date()) {
    await prisma.refreshToken.delete({ where: { token: refreshToken } });
    throw new Error("Refresh token has expired. Please log in again.");
  }

  const user = await prisma.user.findUnique({
    where: { id: decoded.userId },
    include: {
      organization: {
        include: {
          subscription: true,
        },
      },
      employee: {
        include: {
          branch: true,
          shift: true,
          department: true,
        },
      },
    },
  });

  if (!user) {
    throw new Error("User no longer exists");
  }

  const tokenPayload = {
    userId: user.id,
    organizationId: user.organizationId,
    role: user.role,
  };

  const newAccessToken = generateAccessToken(tokenPayload);

  return {
    accessToken: newAccessToken,
    token: newAccessToken,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId,
      organization: user.organization,
      employee: user.employee,
      planLocked: user.organization?.planLocked ?? false,
      mustChangePassword: user.mustChangePassword ?? false,
    },
  };
};

const getMe = async (userId) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      organization: {
        include: {
          subscription: true,
        },
      },
      employee: {
        include: {
          branch: true,
          shift: true,
          department: true,
        },
      },
    },
  });

  if (!user) {
    throw new Error("User not found");
  }

  return {
    id: user.id,
    email: user.email,
    role: user.role,
    organizationId: user.organizationId,
    organization: user.organization,
    employee: user.employee,
    planLocked: user.organization?.planLocked ?? false,
    mustChangePassword: user.mustChangePassword ?? false,
  };
};

const logout = async (refreshToken) => {
  if (refreshToken) {
    try {
      await prisma.refreshToken.deleteMany({ where: { token: refreshToken } });
    } catch (_) { /* ignore if not found */ }
  }
  return { success: true };
};

const getSubscriptionPlans = () => SUBSCRIPTION_PLANS;

/**
 * Activate a plan by verifying the unlock code entered by the admin.
 * Marks the organization as unlocked (planLocked = false).
 */
const activatePlan = async (organizationId, enteredCode) => {
  if (!enteredCode || !enteredCode.trim()) {
    const err = new Error("Unlock code is required.");
    err.statusCode = 400;
    throw err;
  }

  const org = await prisma.organization.findUnique({ where: { id: organizationId } });
  if (!org) {
    const err = new Error("Organization not found.");
    err.statusCode = 404;
    throw err;
  }

  if (!org.planLocked) {
    return { success: true, message: "Plan is already activated.", alreadyActive: true };
  }

  if (!org.unlockCode) {
    const err = new Error("No unlock code has been issued for this organization. Please contact support.");
    err.statusCode = 400;
    throw err;
  }

  const isValid = await bcrypt.compare(enteredCode.trim(), org.unlockCode);
  if (!isValid) {
    const err = new Error("Incorrect unlock code. Please check your registration email and try again.");
    err.statusCode = 400;
    throw err;
  }

  await prisma.organization.update({
    where: { id: organizationId },
    data: {
      planLocked: false,
      unlockCodeUsedAt: new Date(),
      planActivatedAt: new Date(),
    },
  });

  return { success: true, message: "🎉 Plan activated successfully! Your dashboard is now fully unlocked." };
};

/**
 * Change user password — used for forced first-login password reset.
 * Clears mustChangePassword flag after successful change.
 */
const changePassword = async (userId, currentPassword, newPassword) => {
  if (!newPassword || newPassword.length < 8) {
    const err = new Error("New password must be at least 8 characters.");
    err.statusCode = 400;
    throw err;
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    const err = new Error("User not found.");
    err.statusCode = 404;
    throw err;
  }

  // Verify current password (skip check if mustChangePassword and currentPassword not needed)
  if (currentPassword) {
    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) {
      const err = new Error("Current password is incorrect.");
      err.statusCode = 400;
      throw err;
    }
  }

  const salt = await bcrypt.genSalt(10);
  const newHash = await bcrypt.hash(newPassword, salt);

  await prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash: newHash,
      mustChangePassword: false, // clear the forced-reset flag
    },
  });

  return { success: true, message: "Password changed successfully. Please log in with your new password." };
};

module.exports = {
  register,
  login,
  refreshAccessToken,
  logout,
  getMe,
  getSubscriptionPlans,
  activatePlan,
  changePassword,
  SUBSCRIPTION_PLANS,
  PLAN_CONFIGS,
};