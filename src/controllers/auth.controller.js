const authService = require("../services/auth.service");

const getCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: process.env.NODE_ENV === "production" ? "strict" : "lax",
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
});

const register = async (req, res) => {
  try {
    const {
      email,
      password,
      organizationName,
      organizationId,
      firstName,
      lastName,
      role,
      employeeCode,
    } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    const result = await authService.register({
      email,
      password,
      organizationName,
      organizationId,
      firstName,
      lastName,
      role,
      employeeCode,
    });

    // Store Refresh Token securely in HTTP-only Cookie
    res.cookie("refreshToken", result.refreshToken, getCookieOptions());

    return res.status(201).json({
      success: true,
      message: "Registration successful",
      data: {
        accessToken: result.accessToken,
        token: result.accessToken,
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

const login = async (req, res) => {
  try {
    const { email, password, client } = req.body;
    const clientPlatform = client || req.headers["x-client-platform"] || null;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    const result = await authService.login(email, password, clientPlatform);

    // Store Refresh Token securely in HTTP-only Cookie
    res.cookie("refreshToken", result.refreshToken, getCookieOptions());

    return res.json({
      success: true,
      message: "Login successful",
      data: {
        accessToken: result.accessToken,
        token: result.accessToken,
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

    return res.json({
      success: true,
      message: "Access token refreshed successfully",
      data: {
        accessToken: result.accessToken,
        token: result.accessToken,
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
    res.clearCookie("refreshToken", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "strict" : "lax",
    });

    return res.json({
      success: true,
      message: "Logged out successfully",
    });
  } catch (error) {
    return res.status(500).json({
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
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

module.exports = {
  register,
  login,
  refreshToken,
  logout,
  getMe,
};