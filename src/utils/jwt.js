const jwt = require("jsonwebtoken");

const getAccessSecret = () =>
  process.env.ACCESS_TOKEN_SECRET ||
  process.env.JWT_SECRET ||
  "workpulse-super-access-secret-key";

const getRefreshSecret = () =>
  process.env.REFRESH_TOKEN_SECRET ||
  "workpulse-super-refresh-secret-key";

const generateAccessToken = (payload) => {
  return jwt.sign(payload, getAccessSecret(), {
    expiresIn: "15m",
  });
};

const generateRefreshToken = (payload) => {
  return jwt.sign(payload, getRefreshSecret(), {
    expiresIn: "7d",
  });
};

const verifyAccessToken = (token) => {
  return jwt.verify(token, getAccessSecret());
};

const verifyRefreshToken = (token) => {
  return jwt.verify(token, getRefreshSecret());
};

// Aliases for backwards compatibility
const generateToken = generateAccessToken;
const verifyToken = verifyAccessToken;

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  generateToken,
  verifyToken,
};