const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const isProduction = () => process.env.NODE_ENV === "production";

// Outside production a missing secret falls back to a per-boot random value so
// local dev still works, at the cost of invalidating tokens on restart.
const ephemeralSecrets = new Map();

const requireSecret = (name, ...envVars) => {
  for (const envVar of envVars) {
    const value = (process.env[envVar] || "").trim();
    if (value) return value;
  }

  if (isProduction()) {
    throw new Error(
      `Missing required environment variable ${envVars[0]}. Refusing to sign tokens with a default secret.`
    );
  }

  if (!ephemeralSecrets.has(name)) {
    ephemeralSecrets.set(name, crypto.randomBytes(48).toString("hex"));
    console.warn(
      `[jwt] ${envVars[0]} is not set. Using a random ${name} secret for this process only.`
    );
  }
  return ephemeralSecrets.get(name);
};

const getAccessSecret = () =>
  requireSecret("access", "ACCESS_TOKEN_SECRET", "JWT_SECRET");

const getRefreshSecret = () =>
  requireSecret("refresh", "REFRESH_TOKEN_SECRET", "JWT_REFRESH_SECRET");

const generateAccessToken = (payload) => {
  return jwt.sign(payload, getAccessSecret(), {
    expiresIn: "15m",
  });
};

const generateRefreshToken = (payload) => {
  return jwt.sign(payload, getRefreshSecret(), {
    expiresIn: "7d",
    // Without a unique id, tokens created with the same payload in the same
    // second are identical and rotation can accidentally return the old token.
    jwtid: crypto.randomUUID(),
  });
};

const verifyAccessToken = (token) => {
  return jwt.verify(token, getAccessSecret());
};

const verifyRefreshToken = (token) => {
  return jwt.verify(token, getRefreshSecret());
};

const getResetSecret = () =>
  requireSecret("reset", "RESET_PASSWORD_SECRET", "JWT_SECRET");

const generatePasswordResetToken = (payload) => {
  return jwt.sign(payload, getResetSecret(), {
    expiresIn: "1h",
  });
};

const verifyPasswordResetToken = (token) => {
  return jwt.verify(token, getResetSecret());
};

// Aliases for backwards compatibility
const generateToken = generateAccessToken;
const verifyToken = verifyAccessToken;

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  generatePasswordResetToken,
  verifyPasswordResetToken,
  generateToken,
  verifyToken,
};
