


const authService = require("../services/auth.service");
const { sendControllerError } = require("../utils/controllerError");

const isWebClient = (req) => {
  const platform = String(
    req.body?.client || req.headers["x-client-platform"] || "",
  ).toLowerCase();
  return Boolean(req.headers.origin) || platform === "web" || platform === "browser";
};

// Web clients use secure HTTP-only cookies; native/mobile clients receive the refresh token in the response payload.
const refreshTokenForClient = (req, token) =>
  isWebClient(req) ? {} : (token ? { refreshToken: token } : {});

const isInfrastructureError = (error) => {
  const seen = new Set();
  const codes = [];
  const names = [];
  const visit = (item) => {
    if (!item || typeof item !== "object" || seen.has(item)) return;
    seen.add(item);
    if (item.code) codes.push(String(item.code));
    if (item.name) names.push(String(item.name));
    if (Array.isArray(item.errors)) item.errors.forEach(visit);
    visit(item.cause);
  };
  visit(error);

  // pg-pool connection timeouts are plain Errors with no code.
  const messages = [error?.message, error?.cause?.message].filter(Boolean).join(" ");
  if (/timeout exceeded when trying to connect|Connection terminated/i.test(messages)) return true;

  return names.some((name) => /^PrismaClient/.test(name)) || codes.some(
    (code) =>
      code.startsWith("P") ||
      ["EACCES", "ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "ECONNRESET"].includes(code),
  );
};

const loginErrorResponse = (error) => {
  if (error?.statusCode) {
    return {
      status: error.statusCode,
      code: error.code || (error.statusCode === 401 ? "INVALID_CREDENTIALS" : "AUTH_FAILED"),
      message: error.message,
    };
  }
  if (isInfrastructureError(error)) {
    console.error("[Auth] Login infrastructure error:", error);
    return {
      status: 503,
      code: "AUTH_SERVICE_UNAVAILABLE",
      message: "Login service is temporarily unavailable. Please try again shortly.",
    };
  }
  console.error("[Auth] Login failed unexpectedly:", error);
  return {
    status: 500,
    code: "AUTH_FAILED",
    message: "Unable to sign in right now. Please try again.",
  };
};

const getCookieOptions = (role) => {
  const isHttps = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure: isHttps,
    sameSite: isHttps ? "none" : "lax",
    path: "/",
    maxAge: require("../utils/sessionPolicy").getSessionMaxAgeMs(role),
  };
};

const getClearCookieOptions = () => {
  const { maxAge, ...options } = getCookieOptions();
  return options;
};

const register = async (req, res) => {
  try {
    const {
      email,
      password,
      organizationName,
      firstName,
      lastName,
      employeeCode,
      subscriptionPlan,
      billingCycle,
    } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    // organizationId and role are deliberately NOT read from the body — see authService.register.
    const result = await authService.register({
      email,
      password,
      organizationName,
      firstName,
      lastName,
      employeeCode,
      subscriptionPlan,
      billingCycle,
    });
    // No session is created yet — the account cannot log in until the emailed
    // verification code is confirmed, so no refresh-token cookie is set here.
    return res.status(201).json({
      success: true,
      message: result.message,
      data: {
        requiresVerification: result.requiresVerification,
        email: result.email,
        requiresCheckout: result.requiresCheckout,
        selectedPlan: result.selectedPlan,
        ...(result.verificationCode ? { verificationCode: result.verificationCode, simulated: result.simulated } : {}),
      },
    });
  } catch (error) { return sendControllerError(res, error); }
};

/**
 * POST /api/auth/verify-email
 * Public endpoint to confirm a signup verification code and activate the account.
 */
const verifyEmail = async (req, res) => {
  try {
    const { email, code } = req.body;
    const result = await authService.verifyEmail(email, code);
    res.cookie("refreshToken", result.refreshToken, getCookieOptions(result.user?.role));
    return res.status(200).json({
      success: true,
      message: "Email verified successfully",
      data: {
        accessToken: result.accessToken,
        token: result.accessToken,
        ...refreshTokenForClient(req, result.refreshToken),
        user: result.user,
      },
    });
  } catch (error) { return sendControllerError(res, error); }
};

/**
 * POST /api/auth/resend-verification
 * Public endpoint to request a fresh verification code.
 */
const resendVerification = async (req, res) => {
  try {
    const { email } = req.body;
    const result = await authService.resendVerificationCode(email);
    return res.status(200).json(result);
  } catch (error) { return sendControllerError(res, error); }
};

const loginWithGoogle = async (req, res) => {
  try {
    const { idToken, client } = req.body;
    const clientPlatform = client || req.headers["x-client-platform"] || null;
    const result = await authService.loginWithGoogle(idToken, clientPlatform);
    res.cookie("refreshToken", result.refreshToken, getCookieOptions(result.user?.role));
    return res.json({
      success: true,
      message: "Google sign-in successful",
      data: {
        accessToken: result.accessToken,
        token: result.accessToken,
        ...refreshTokenForClient(req, result.refreshToken),
        user: result.user,
      },
    });
  } catch (error) { return sendControllerError(res, error, { fallbackStatus: 401 }); }
};

const login = async (req, res) => {
  try {
    const { email, password, client, employeeCode, phone } = req.body;
    const clientPlatform = client || req.headers["x-client-platform"] || null;

    if ((!email && !employeeCode && !phone) || !password) {
      return res.status(400).json({
        success: false,
        message: "Email, phone number, or employee code and password are required",
      });
    }

    const result = await authService.login(
      email,
      password,
      clientPlatform,
      employeeCode,
      phone,
    );
    if (result.twoFactorRequired) {
      return res.status(200).json({
        success: true,
        twoFactorRequired: true,
        message: result.message,
        data: { twoFactorRequired: true, challengeToken: result.challengeToken, user: result.user },
      });
    }
    res.cookie("refreshToken", result.refreshToken, getCookieOptions(result.user?.role));

    return res.json({
      success: true,
      message: "Login successful",
      data: {
        accessToken: result.accessToken,
        token: result.accessToken,
        ...refreshTokenForClient(req, result.refreshToken),
        user: result.user,
      },
    });
  } catch (error) {
    const response = loginErrorResponse(error);
    return res.status(response.status).json({
      success: false,
      code: response.code,
      message: response.message,
    });
  }
};

const verifyTwoFactorLogin = async (req, res) => {
  try {
    const result = await authService.verifyTwoFactorLogin(req.body.challengeToken, req.body.code);
    res.cookie("refreshToken", result.refreshToken, getCookieOptions(result.user?.role));
    return res.json({ success: true, message: "Login successful", data: { accessToken: result.accessToken, token: result.accessToken, ...refreshTokenForClient(req, result.refreshToken), user: result.user } });
  } catch (error) { return sendControllerError(res, error, { fallbackStatus: 401 }); }
};

const beginTwoFactorSetup = async (req, res) => {
  try { return res.json({ success: true, data: await authService.beginTwoFactorSetup(req.user.id) }); }
  catch (error) { return sendControllerError(res, error); }
};

const confirmTwoFactorSetup = async (req, res) => {
  try { return res.json({ success: true, data: await authService.confirmTwoFactorSetup(req.user.id, req.body.code) }); }
  catch (error) { return sendControllerError(res, error); }
};

const disableTwoFactor = async (req, res) => {
  try { return res.json({ success: true, data: await authService.disableTwoFactor(req.user.id, req.body.code) }); }
  catch (error) { return sendControllerError(res, error); }
};

const refreshToken = async (req, res) => {
  try {
    // Check in HTTP-only cookie first, with fallback to request body
    const token = req.cookies?.refreshToken || req.body?.refreshToken;

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Refresh token not found in cookies or request body",
      });
    }

    const result = await authService.refreshAccessToken(token);

    // The presented refresh token has just been revoked. Persist its rotated
    // replacement for browser clients, which cannot update an HTTP-only cookie.
    res.cookie("refreshToken", result.refreshToken, getCookieOptions(result.user?.role));

    return res.json({
      success: true,
      message: "Access token refreshed successfully",
      data: {
        accessToken: result.accessToken,
        token: result.accessToken,
        ...refreshTokenForClient(req, result.refreshToken || token),
        user: result.user,
      },
    });
  } catch (error) { return sendControllerError(res, error, { fallbackStatus: 401, fallbackMessage: "Invalid or expired refresh token" }); }
};

const logout = async (req, res) => {
  try {
    const token = req.cookies?.refreshToken || req.body?.refreshToken;
    await authService.logout(token);

    res.clearCookie("refreshToken", getClearCookieOptions());

    return res.json({ success: true, message: "Logged out successfully" });
  } catch (error) { return sendControllerError(res, error, { fallbackStatus: 500, fallbackMessage: "Error during logout" }); }
};

const getMe = async (req, res) => {
  try {
    const result = await authService.getMe(req.user.id);

    return res.json({
      success: true,
      message: "Current user profile fetched successfully",
      data: result,
      user: result,
    });
  } catch (error) { return sendControllerError(res, error, { fallbackStatus: 400 }); }
};

const updateMe = async (req, res) => {
  try {
    const avatarUrl = req.body?.avatarUrl;
    if (avatarUrl === undefined) {
      return res.status(400).json({
        success: false,
        message: "Nothing to update. Send avatarUrl or upload a photo to /auth/avatar.",
      });
    }
    const avatarService = require("../services/avatar.service");
    const user = await avatarService.setMyAvatar(
      req.user.id,
      req.user.organizationId,
      avatarUrl === "" || avatarUrl === null ? null : avatarUrl,
    );
    return res.json({
      success: true,
      message: "Profile photo updated",
      data: user,
      user,
    });
  } catch (error) { return sendControllerError(res, error); }
};

const uploadAvatar = async (req, res) => {
  try {
    const avatarService = require("../services/avatar.service");
    const url = await avatarService.uploadAvatarFile(req);
    const user = await avatarService.setMyAvatar(
      req.user.id,
      req.user.organizationId,
      url,
    );
    return res.json({
      success: true,
      message: "Profile photo updated",
      data: { ...user, url, avatarUrl: url },
      user,
    });
  } catch (error) { return sendControllerError(res, error, { fallbackMessage: "Failed to upload photo" }); }
};

const getPlans = async (req, res) => {
  try {
    const plans = await authService.getSubscriptionPlans();
    return res.json({
      success: true,
      plans,
    });
  } catch (error) {
    return sendControllerError(res, error, {
      fallbackStatus: 500,
      fallbackMessage: "Failed to fetch subscription plans",
    });
  }
};

/**
 * POST /api/auth/activate-plan
 * Admin enters the unlock code received by email to activate their plan.
 */
const activatePlan = async (req, res) => {
  try {
    const { unlockCode } = req.body;
    const result = await authService.activatePlan(
      req.user.organizationId,
      unlockCode,
    );
    return res.status(200).json(result);
  } catch (error) { return sendControllerError(res, error); }
};

/**
 * POST /api/auth/change-password
 * Employee/Admin changes their password (used on first login forced reset).
 */
const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!newPassword) {
      return res
        .status(400)
        .json({ success: false, message: "New password is required." });
    }
    const result = await authService.changePassword(
      req.user.id,
      currentPassword,
      newPassword,
    );
    return res.status(200).json(result);
  } catch (error) { return sendControllerError(res, error); }
};

/**
 * POST /api/auth/upgrade-plan
 * Admin upgrades or changes their organization subscription plan.
 */
const upgradePlan = async (req, res) => {
  try {
    const { plan, billingCycle } = req.body;
    if (!plan) {
      return res
        .status(400)
        .json({
          success: false,
          message: "Subscription plan tier is required.",
        });
    }
    const result = await authService.upgradePlan(
      req.user.organizationId,
      plan,
      billingCycle,
      { actorRole: req.user.role, actorUserId: req.user.id },
    );
    return res.status(200).json(result);
  } catch (error) { return sendControllerError(res, error); }
};

/**
 * POST /api/auth/forgot-password
 * Public endpoint to request a password reset email link
 */
const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    const result = await authService.forgotPassword(email);
    return res.status(200).json(result);
  } catch (error) { return sendControllerError(res, error); }
};

/**
 * POST /api/auth/reset-password
 * Public endpoint to reset password with valid token
 */
const resetPassword = async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    const result = await authService.resetPassword(token, newPassword);
    return res.status(200).json(result);
  } catch (error) { return sendControllerError(res, error); }
};

module.exports = {
  register,
  verifyEmail,
  resendVerification,
  login,
  loginWithGoogle,
  refreshToken,
  logout,
  getMe,
  updateMe,
  uploadAvatar,
  getPlans,
  activatePlan,
  upgradePlan,
  changePassword,
  forgotPassword,
  resetPassword,
  verifyTwoFactorLogin,
  beginTwoFactorSetup,
  confirmTwoFactorSetup,
  disableTwoFactor,
};
