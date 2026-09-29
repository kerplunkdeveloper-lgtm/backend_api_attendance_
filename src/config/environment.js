const requiredOneOf = (names) => {
  if (names.some((name) => String(process.env[name] || "").trim())) return;
  throw new Error(`Missing required environment variable: ${names.join(" or ")}`);
};

const DEFAULT_PRODUCTION_FRONTEND_URL = "https://workplusein.netlify.app";

const validateUrl = (name) => {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol)) throw new Error("unsupported protocol");
  } catch {
    throw new Error(`${name} must be an absolute HTTP(S) URL`);
  }
};

const validateEnvironment = () => {
  if (process.env.NODE_ENV !== "production") return;
  // Railway currently has no FRONTEND_URL variable. Keep the canonical app
  // origin as a secure default so CORS and cookie-CSRF checks remain exact,
  // while still allowing an environment override for future custom domains.
  process.env.FRONTEND_URL ||= DEFAULT_PRODUCTION_FRONTEND_URL;
  validateUrl("FRONTEND_URL");
  requiredOneOf(["ACCESS_TOKEN_SECRET", "JWT_SECRET"]);
  requiredOneOf(["REFRESH_TOKEN_SECRET", "JWT_REFRESH_SECRET"]);
  requiredOneOf(["RESET_PASSWORD_SECRET", "JWT_SECRET"]);
};

module.exports = { DEFAULT_PRODUCTION_FRONTEND_URL, validateEnvironment };
