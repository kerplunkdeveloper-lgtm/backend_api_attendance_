const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const prisma = require("../config/database");
const {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  generatePasswordResetToken,
  verifyPasswordResetToken,
} = require("../utils/jwt");
const emailService = require("./email.service");
const { organizationWithSubscription } = require("../utils/prismaSelects");
const { resolveAvatarUrl } = require("../utils/avatar");

const MIN_PASSWORD_LENGTH = 8;

/**
 * Returns an error message when the password is unacceptable, or null when it passes.
 */
const validatePasswordStrength = (password) => {
  if (!password || typeof password !== "string") {
    return "Password is required.";
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`;
  }
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return "Password must contain at least one letter and one number.";
  }
  return null;
};

const SUBSCRIPTION_PLANS = [
  {
    id: "FREE_TRIAL",
    name: "Free Trial",
    badge: "14-Day Free Trial",
    priceMonthly: 0,
    priceAnnual: 0,
    currency: "INR",
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
    priceMonthly: 2499,
    priceAnnual: 24990,
    currency: "INR",
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
    priceMonthly: 6999,
    priceAnnual: 69990,
    currency: "INR",
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
    priceMonthly: 16999,
    priceAnnual: 169990,
    currency: "INR",
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

const { PLAN_CONFIGS } = require("../config/plans");

/**
 * Public self-serve signup. This always provisions a NEW workspace and makes the
 * caller its COMPANY_ADMIN. Joining an existing organization is only possible via
 * an authenticated invite (POST /api/employees/invite) — accepting an
 * organizationId or role from an anonymous request body would let anyone who
 * learns another tenant's id create an admin account inside it.
 */
const register = async ({
  email,
  password,
  organizationName,
  firstName,
  lastName,
  employeeCode,
  subscriptionPlan,
  billingCycle,
}) => {
  const cleanEmail = email.trim().toLowerCase();

  const passwordError = validatePasswordStrength(password);
  if (passwordError) {
    const err = new Error(passwordError);
    err.statusCode = 400;
    throw err;
  }

  // Email is unique per organization, not globally. A consultant can belong
  // to more than one workspace with the same address.

  // Determine subscription plan configuration
  // Plan selection is not payment. Every new workspace receives only a trial.
  const chosenPlanKey = "FREE_TRIAL";
  const planMeta = PLAN_CONFIGS[chosenPlanKey] || PLAN_CONFIGS.FREE_TRIAL;
  const cycle = (billingCycle || "MONTHLY").toUpperCase() === "ANNUAL" ? "ANNUAL" : "MONTHLY";

  const now = new Date();
  const trialEndsAt = planMeta.trialDays ? new Date(now.getTime() + planMeta.trialDays * 24 * 60 * 60 * 1000) : null;
  const periodDays = cycle === "ANNUAL" ? 365 : 30;
  const currentPeriodEnd = new Date(now.getTime() + periodDays * 24 * 60 * 60 * 1000);
  const calculatedPrice = cycle === "ANNUAL" ? planMeta.price * 10 : planMeta.price;

  let finalOrgId;

  {
    const isTrial = planMeta.plan === "FREE_TRIAL";
    const org = await prisma.organization.create({
      data: {
        name: organizationName || "Default Organization",
        subscriptionPlan: planMeta.plan,
        subscriptionStatus: planMeta.status,
        trialEndsAt,
        subscriptionExpiresAt: isTrial ? trialEndsAt : currentPeriodEnd,
        maxEmployees: planMeta.maxEmployees,
        planLocked: false, // New workspaces start unlocked and ready to test
        planActivatedAt: now,
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

    // Automatically provision default branch, shift, departments, and leave types for this fresh organization
    try {
      await prisma.branch.create({
        data: {
          organizationId: finalOrgId,
          name: "Main Head Office",
          address: "100 Corporate Boulevard, Business District",
          latitude: 11.9344,
          longitude: 79.8358,
          radiusMeters: 300,
        },
      });

      await prisma.shift.create({
        data: {
          organizationId: finalOrgId,
          name: "General Shift (09:00 - 18:00)",
          startTime: "09:00",
          endTime: "18:00",
          graceMinutes: 15,
          workingDays: "1,2,3,4,5,6",
        },
      });

      const defaultDepts = ["Management", "Human Resources", "Engineering", "Operations", "Sales"];
      for (const dName of defaultDepts) {
        await prisma.department.create({
          data: { organizationId: finalOrgId, name: dName },
        }).catch(() => {});
      }

      const defaultLeaveTypes = [
        { name: "Casual Leave", code: "CL", daysAllowed: 12, isPaid: true },
        { name: "Sick Leave", code: "SL", daysAllowed: 10, isPaid: true },
        { name: "Earned / Annual Leave", code: "AL", daysAllowed: 15, isPaid: true },
        { name: "Unpaid Leave (LWP)", code: "LWP", daysAllowed: 30, isPaid: false },
      ];
      for (const lt of defaultLeaveTypes) {
        await prisma.leaveType.create({
          data: { ...lt, organizationId: finalOrgId },
        }).catch(() => {});
      }
    } catch (provisionErr) {
      console.warn("[Register] Default org entities provisioning warning:", provisionErr.message);
    }
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

  const finalRole = "COMPANY_ADMIN";

  const registerAvatar = resolveAvatarUrl({ firstName, lastName, employeeCode });

  const user = await prisma.user.create({
    data: {
      email: cleanEmail,
      passwordHash,
      role: finalRole,
      organizationId: finalOrgId,
      avatarUrl: registerAvatar,
      ...(firstName
        ? {
            employee: {
              create: {
                organizationId: finalOrgId,
                employeeCode:
                  employeeCode || `EMP-${Date.now().toString().slice(-6)}`,
                firstName,
                lastName: lastName || null,
                avatarUrl: registerAvatar,
              },
            },
          }
        : {}),
    },
    include: {
      organization: organizationWithSubscription,
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

  // Echo the unlock code locally so developers can complete the flow without a
  // working mail provider. Never do this in production — logs are not a secret store.
  if (process.env.NODE_ENV !== "production") {
    console.log("────────────────────────────────────────────────────────────");
    console.log(`[Register] Organization: ${organizationName || "Default Organization"}`);
    console.log(`[Register] Admin Email : ${cleanEmail}`);
    console.log("────────────────────────────────────────────────────────────");
  }

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
      mustChangePassword: false,
    },
  };
};


const login = async (email, password, client = null, employeeCode = null) => {
  // Mobile clients send employeeCode when the identifier has no '@'. Either
  // form is accepted — the previous implementation only read `email`.
  const cleanEmail = email ? email.trim().toLowerCase() : "";
  const cleanCode = employeeCode ? String(employeeCode).trim() : "";

  const loginInclude = {
    organization: organizationWithSubscription,
    employee: {
      include: {
        branch: true,
        shift: true,
        department: true,
      },
    },
  };

  const candidates = await prisma.user.findMany({
    where: cleanEmail
      ? { email: { equals: cleanEmail, mode: "insensitive" } }
      : cleanCode
        ? { employee: { employeeCode: { equals: cleanCode, mode: "insensitive" }, deletedAt: null } }
        : { id: "__never__" },
    include: loginInclude,
  });

  const matches = [];
  for (const candidate of candidates) {
    const passwordValid = await bcrypt.compare(password, candidate.passwordHash);
    if (passwordValid) matches.push(candidate);
  }

  if (matches.length === 0) {
    throw new Error("Invalid email or password");
  }
  if (matches.length > 1) {
    const error = new Error(
      "This login matches more than one workspace. Sign in with your employee code, or ask your administrator for the correct workspace."
    );
    error.statusCode = 409;
    throw error;
  }

  const user = matches[0];

  if (user.isActive === false) {
    const error = new Error("This account has been deactivated. Contact your administrator.");
    error.statusCode = 403;
    throw error;
  }

  if (user.organization?.deletedAt) {
    const error = new Error("This organization is no longer active.");
    error.statusCode = 403;
    throw error;
  }

  if (user.employee?.deletedAt) {
    const error = new Error("This employee profile has been removed. Contact your administrator.");
    error.statusCode = 403;
    throw error;
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

  // Update lastLoginAt in background without blocking login response latency
  prisma.user
    .update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    })
    .catch((err) => console.warn("[Auth] Failed to update lastLoginAt:", err.message));

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
  if (storedToken.userId !== decoded.userId) {
    throw new Error("Refresh token does not belong to this user. Please log in again.");
  }
  if (storedToken.expiresAt < new Date()) {
    await prisma.refreshToken.delete({ where: { token: refreshToken } });
    throw new Error("Refresh token has expired. Please log in again.");
  }

  const user = await prisma.user.findUnique({
    where: { id: decoded.userId },
    include: {
      organization: organizationWithSubscription,
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
  if (user.isActive === false) {
    const error = new Error("This account has been deactivated.");
    error.statusCode = 403;
    throw error;
  }
  if (user.organization?.deletedAt) {
    const error = new Error("This organization is no longer active.");
    error.statusCode = 403;
    throw error;
  }
  if (user.employee?.deletedAt) {
    const error = new Error("This employee record is no longer active.");
    error.statusCode = 403;
    throw error;
  }

  const tokenPayload = {
    userId: user.id,
    organizationId: user.organizationId,
    role: user.role,
  };

  const newAccessToken = generateAccessToken(tokenPayload);

  // Rotate the refresh token: revoke the presented token and issue a fresh one
  // so a leaked token is only usable once and replay attempts are rejected.
  const refreshExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const newRefreshToken = generateRefreshToken(tokenPayload);
  await prisma.$transaction([
    prisma.refreshToken.delete({ where: { token: refreshToken } }),
    prisma.refreshToken.create({
      data: { userId: user.id, token: newRefreshToken, expiresAt: refreshExpiresAt },
    }),
  ]);

  return {
    accessToken: newAccessToken,
    token: newAccessToken,
    refreshToken: newRefreshToken,
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
      organization: organizationWithSubscription,
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

  require("./entitlement.service").assertEntitled(org);

  if (!org.planLocked) {
    return { success: true, message: "Plan is already activated.", alreadyActive: true };
  }

  let isValid = false;
  if (org.unlockCode) {
    try {
      isValid = await bcrypt.compare(enteredCode.trim(), org.unlockCode);
    } catch {
      isValid = false;
    }
  }

  if (!isValid) {
    const err = new Error("Incorrect unlock code. Check the activation email sent to your workspace owner.");
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
 * Upgrade or switch organization subscription plan tier.
 */
const upgradePlan = async () => {
  throw Object.assign(new Error("Use billing checkout to purchase a plan. Direct activation is disabled."), { statusCode: 403 });
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

/**
 * Initiates forgot password flow:
 * 1. Checks if user exists by email
 * 2. Generates single-use JWT with passwordHash version
 * 3. Dispatches branded email with reset link
 */
const forgotPassword = async (email) => {
  if (!email || !email.trim()) {
    const err = new Error("Corporate email address is required.");
    err.statusCode = 400;
    throw err;
  }

  const normalizedEmail = email.toLowerCase().trim();
  const users = await prisma.user.findMany({
    where: { email: { equals: normalizedEmail, mode: "insensitive" }, isActive: true },
    include: { employee: true, organization: organizationWithSubscription },
  });

  // Always return identical success message to prevent user enumeration attacks
  const genericMessage =
    "If that corporate email address is registered in WorkPulse, you will receive password reset instructions shortly.";

  if (!users.length) {
    return {
      success: true,
      message: genericMessage,
    };
  }

  const frontendUrl = (process.env.FRONTEND_URL || "http://localhost:3000").replace(/\/+$/, "");
  const resetUrls = [];
  let lastEmailResult = null;

  for (const user of users) {
    const resetToken = generatePasswordResetToken({
      userId: user.id,
      email: user.email,
      type: "PASSWORD_RESET",
      v: user.passwordHash.slice(-10),
    });
    const resetUrl = `${frontendUrl}/reset-password?token=${encodeURIComponent(resetToken)}`;
    const userName = user.employee
      ? `${user.employee.firstName} ${user.employee.lastName || ""}`.trim()
      : user.email.split("@")[0];

    lastEmailResult = await emailService.sendPasswordResetEmail(user.email, userName, {
      resetUrl,
      expiresIn: "60 minutes",
      organizationName: user.organization?.name,
    });
    resetUrls.push(resetUrl);
  }

  return {
    success: true,
    message: genericMessage,
    ...(process.env.NODE_ENV !== "production" || process.env.FRONTEND_URL?.includes("localhost") || lastEmailResult?.simulated
      ? { resetUrl: resetUrls[0], resetUrls, simulated: lastEmailResult?.simulated || false }
      : {}),
  };
};

/**
 * Completes password reset:
 * 1. Validates and decodes resetToken
 * 2. Verifies user exists and token has not been reused
 * 3. Hashes new password and updates DB
 * 4. Revokes active refresh tokens to terminate existing sessions
 */
const resetPassword = async (token, newPassword) => {
  if (!token) {
    const err = new Error("Password reset token is missing or invalid.");
    err.statusCode = 400;
    throw err;
  }

  if (!newPassword || newPassword.length < 8) {
    const err = new Error("New password must be at least 8 characters long.");
    err.statusCode = 400;
    throw err;
  }

  let decoded;
  try {
    decoded = verifyPasswordResetToken(token);
  } catch (err) {
    const error = new Error("The password reset link is invalid or has expired. Please request a new one.");
    error.statusCode = 400;
    throw error;
  }

  if (decoded.type !== "PASSWORD_RESET" || !decoded.userId || !decoded.v) {
    const error = new Error("Malformed password reset token.");
    error.statusCode = 400;
    throw error;
  }

  const user = await prisma.user.findUnique({
    where: { id: decoded.userId },
  });

  if (!user) {
    const error = new Error("User associated with this reset request no longer exists.");
    error.statusCode = 404;
    throw error;
  }

  // Token freshness check: ensures token has not already been used to change password
  if (user.passwordHash.slice(-10) !== decoded.v) {
    const error = new Error(
      "This password reset link has already been used. Please submit a new forgot password request."
    );
    error.statusCode = 400;
    throw error;
  }

  const salt = await bcrypt.genSalt(10);
  const newHash = await bcrypt.hash(newPassword, salt);

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: newHash,
      mustChangePassword: false,
    },
  });

  // Revoke all existing refresh tokens for security
  await prisma.refreshToken.deleteMany({
    where: { userId: user.id },
  });

  return {
    success: true,
    message: "Password reset successful! You can now log in with your new password.",
  };
};

const loginWithGoogle = async (idToken, client = null) => {
  if (!idToken) {
    const error = new Error("Google idToken is required");
    error.statusCode = 400;
    throw error;
  }
  const expectedAud = (process.env.GOOGLE_CLIENT_ID || "").trim();
  if (!expectedAud) {
    const error = new Error("Google sign-in is not configured.");
    error.statusCode = 503;
    throw error;
  }
  const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
  const profile = await res.json();
  if (!profile.email || (profile.email_verified !== "true" && profile.email_verified !== true)) {
    const error = new Error("Google token is invalid or email is not verified");
    error.statusCode = 401;
    throw error;
  }
  if (profile.aud !== expectedAud) {
    const error = new Error("Google token audience is invalid.");
    error.statusCode = 401;
    throw error;
  }
  const cleanEmail = String(profile.email).trim().toLowerCase();
  const users = await prisma.user.findMany({
    where: { email: { equals: cleanEmail, mode: "insensitive" } },
    include: {
      organization: organizationWithSubscription,
      employee: { include: { branch: true, shift: true, department: true } },
    },
  });
  if (users.length === 0) {
    const error = new Error("No WorkPulse account uses this Google email. Register or ask HR to invite you first.");
    error.statusCode = 404;
    throw error;
  }
  if (users.length > 1) {
    const error = new Error("This Google email matches more than one workspace. Sign in with email and password.");
    error.statusCode = 409;
    throw error;
  }
  const user = users[0];
  if (user.isActive === false) {
    const error = new Error("This account has been deactivated.");
    error.statusCode = 403;
    throw error;
  }
  if (client === "web" && user.role === "EMPLOYEE") {
    const error = new Error("Web access is for admins and managers. Use the mobile app.");
    error.statusCode = 403;
    throw error;
  }
  if (profile.sub && !user.googleSub) {
    await prisma.user.update({ where: { id: user.id }, data: { googleSub: profile.sub } });
  }
  const tokenPayload = { userId: user.id, organizationId: user.organizationId, role: user.role };
  const accessToken = generateAccessToken(tokenPayload);
  const refreshToken = generateRefreshToken(tokenPayload);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await prisma.$transaction([
    prisma.refreshToken.create({ data: { userId: user.id, token: refreshToken, expiresAt } }),
    prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }),
  ]);
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

module.exports = {
  register,
  login,
  loginWithGoogle,
  refreshAccessToken,
  logout,
  getMe,
  getSubscriptionPlans,
  activatePlan,
  upgradePlan,
  changePassword,
  forgotPassword,
  resetPassword,
  SUBSCRIPTION_PLANS,
  PLAN_CONFIGS,
};
