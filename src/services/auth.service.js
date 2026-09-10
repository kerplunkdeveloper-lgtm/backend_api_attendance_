const bcrypt = require("bcryptjs");
const prisma = require("../config/database");
const {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
} = require("../utils/jwt");

const register = async ({
  email,
  password,
  organizationName,
  organizationId,
  firstName,
  lastName,
  role,
  employeeCode,
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
      },
    });
    finalOrgId = org.id;
  }

  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(password, salt);

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
      organization: true,
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
      organization: true,
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
    },
  };
};

const refreshAccessToken = async (refreshToken) => {
  if (!refreshToken) {
    throw new Error("Refresh token is required");
  }

  let decoded;
  try {
    decoded = verifyRefreshToken(refreshToken);
  } catch (err) {
    throw new Error("Invalid or expired refresh token");
  }

  if (!decoded || !decoded.userId) {
    throw new Error("Invalid token payload");
  }

  const user = await prisma.user.findUnique({
    where: { id: decoded.userId },
    include: {
      organization: true,
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
    },
  };
};

const getMe = async (userId) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      organization: true,
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
  };
};

module.exports = {
  register,
  login,
  refreshAccessToken,
  getMe,
};