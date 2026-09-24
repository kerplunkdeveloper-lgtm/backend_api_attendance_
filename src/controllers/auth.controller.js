const authService = require("../services/auth.service");

const getCookieOptions = () => {
  const isHttps =
    process.env.NODE_ENV === "production" &&
    process.env.BACKEND_URL?.startsWith("https://");
  return {
    httpOnly: true,
    secure: isHttps,
    sameSite: isHttps ? "none" : "lax",
    path: "/",
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
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

    // Store Refresh Token securely in HTTP-only Cookie
    res.cookie("refreshToken", result.refreshToken, getCookieOptions());

    return res.status(201).json({
      success: true,
      message: "Registration successful",
      data: {
        accessToken: result.accessToken,
        token: result.accessToken,
        refreshToken: result.refreshToken,
        user: result.user,
      },
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

const loginWithGoogle = async (req, res) => {
  try {
    const { idToken, client } = req.body;
    const clientPlatform = client || req.headers["x-client-platform"] || null;
    const result = await authService.loginWithGoogle(idToken, clientPlatform);
    res.cookie("refreshToken", result.refreshToken, getCookieOptions());
    return res.json({
      success: true,
      message: "Google sign-in successful",
      data: {
        accessToken: result.accessToken,
        token: result.accessToken,
        refreshToken: result.refreshToken,
        user: result.user,
      },
    });
  } catch (error) {
    return res.status(error.statusCode || 401).json({
      success: false,
      message: error.message,
    });
  }
};

const login = async (req, res) => {
  try {
    const { email, password, client, employeeCode } = req.body;
    const clientPlatform = client || req.headers["x-client-platform"] || null;

    if ((!email && !employeeCode) || !password) {
      return res.status(400).json({
        success: false,
        message: "Email (or employee code) and password are required",
      });
    }

    const result = await authService.login(
      email,
      password,
      clientPlatform,
      employeeCode,
    );

    // Store Refresh Token securely in HTTP-only Cookie
    res.cookie("refreshToken", result.refreshToken, getCookieOptions());

    return res.json({
      success: true,
      message: "Login successful",
      data: {
        accessToken: result.accessToken,
        token: result.accessToken,
        refreshToken: result.refreshToken,
        user: result.user,
      },
    });
  } catch (error) {
    return res.status(error.statusCode || 401).json({
      success: false,
      code: error.code || "AUTH_FAILED",
      message: error.message,
    });
  }
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
    res.cookie("refreshToken", result.refreshToken, getCookieOptions());

    return res.json({
      success: true,
      message: "Access token refreshed successfully",
      data: {
        accessToken: result.accessToken,
        token: result.accessToken,
        refreshToken: result.refreshToken || token,
        user: result.user,
      },
    });
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: error.message || "Invalid or expired refresh token",
    });
  }
};

const logout = async (req, res) => {
  try {
    const token = req.cookies?.refreshToken || req.body?.refreshToken;
    await authService.logout(token);

    res.clearCookie("refreshToken", getClearCookieOptions());

    return res.json({ success: true, message: "Logged out successfully" });
  } catch (error) {
    return res
      .status(500)
      .json({
        success: false,
        message: error.message || "Error during logout",
      });
  }
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
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

const getPlans = (req, res) => {
  try {
    const plans = authService.getSubscriptionPlans();
    return res.json({
      success: true,
      plans,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch subscription plans",
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
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message,
    });
  }
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
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message,
    });
  }
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
    );
    return res.status(200).json(result);
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message,
    });
  }
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
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message,
    });
  }
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
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message,
    });
  }
};

module.exports = {
  register,
  login,
  loginWithGoogle,
  refreshToken,
  logout,
  getMe,
  getPlans,
  activatePlan,
  upgradePlan,
  changePassword,
  forgotPassword,
  resetPassword,
};
