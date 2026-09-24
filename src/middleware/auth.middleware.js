const prisma = require("../config/database");
const { verifyAccessToken } = require("../utils/jwt");
const { organizationWithSubscription } = require("../utils/prismaSelects");

const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Authorization token required",
      });
    }

    const token = authHeader.split(" ")[1];
    const decoded = verifyAccessToken(token);

    if (!decoded || !decoded.userId) {
      return res.status(401).json({
        success: false,
        message: "Invalid token payload",
      });
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
      return res.status(401).json({
        success: false,
        message: "User not found or token no longer valid",
      });
    }

    // Terminated/suspended users keep a technically valid JWT until it expires,
    // so access has to be re-checked against the database on every request.
    if (user.isActive === false) {
      return res.status(403).json({
        success: false,
        message: "This account has been deactivated.",
      });
    }

    if (user.organization?.deletedAt) {
      return res.status(403).json({
        success: false,
        message: "This organization is no longer active.",
      });
    }

    if (user.employee?.deletedAt) {
      return res.status(403).json({
        success: false,
        message: "This employee profile has been removed.",
      });
    }

    req.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId,
      organization: user.organization,
      employee: user.employee,
    };

    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token",
    });
  }
};

/**
 * Role-Based Access Control (RBAC) middleware
 * Enforces that req.user.role is included in the allowedRoles list.
 */
const authorizeRoles = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required before checking role permissions",
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Forbidden: User role '${req.user.role}' is not authorized to access this resource.`,
        requiredRoles: allowedRoles,
        userRole: req.user.role,
      });
    }

    next();
  };
};

module.exports = {
  authenticate,
  authorizeRoles,
};
