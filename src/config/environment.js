const requiredOneOf = (names) => {
  if (names.some((name) => String(process.env[name] || "").trim())) return;
  throw new Error(
    `Missing required environment variable: ${names.join(" or ")}`,
  );
};

// The production frontend is hosted on Vercel. Keep the previous Netlify
// origin trusted during the transition so existing links do not break.
const DEFAULT_PRODUCTION_FRONTEND_URL = "https://workpluse-frontend.vercel.app";
const LEGACY_PRODUCTION_FRONTEND_URL = "https://workplusein.netlify.app";

const validateUrl = (name) => {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol))
      throw new Error("unsupported protocol");
  } catch {
    throw new Error(`${name} must be an absolute HTTP(S) URL`);
  }
};

const rejectLocalProductionOrigins = () => {
  const origins = String(process.env.CORS_ALLOWED_ORIGINS || "")
    .split(",").map((value) => value.trim()).filter(Boolean);
  for (const origin of origins) {
    try {
      const hostname = new URL(origin).hostname.toLowerCase();
      if (hostname === "localhost" || hostname === "127.0.0.1" || /^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)) {
        throw new Error("CORS_ALLOWED_ORIGINS cannot contain localhost or private LAN addresses in production");
      }
    } catch (error) {
      if (error.message.includes("cannot contain")) throw error;
      throw new Error("CORS_ALLOWED_ORIGINS must contain only absolute HTTP(S) origins");
    }
  }
};

const validateEnvironment = () => {
  requiredOneOf(["DATABASE_URL"]);
  if (process.env.NODE_ENV !== "production") return;

  // Railway currently has no FRONTEND_URL variable. Keep the canonical app
  // origin as a secure default so CORS and cookie-CSRF checks remain exact,
  // while still allowing an environment override for future custom domains.
  process.env.FRONTEND_URL ||= DEFAULT_PRODUCTION_FRONTEND_URL;
  validateUrl("FRONTEND_URL");
  requiredOneOf(["BACKEND_PUBLIC_URL", "BACKEND_URL"]);
  if (process.env.BACKEND_PUBLIC_URL || process.env.BACKEND_URL) {
    const backendUrlName = process.env.BACKEND_PUBLIC_URL ? "BACKEND_PUBLIC_URL" : "BACKEND_URL";
    validateUrl(backendUrlName);
  }
  rejectLocalProductionOrigins();

  // Auth secrets
  requiredOneOf(["ACCESS_TOKEN_SECRET", "JWT_SECRET"]);
  requiredOneOf(["REFRESH_TOKEN_SECRET", "JWT_REFRESH_SECRET", "JWT_SECRET"]);
  requiredOneOf(["RESET_PASSWORD_SECRET", "JWT_SECRET"]);

  // Database — direct URL needed for Prisma migrations over pooled Neon
  requiredOneOf(["DIRECT_URL", "DATABASE_URL"]);

  // File storage — missing this makes all uploads fail silently
  requiredOneOf(["CLOUDINARY_CLOUD_NAME"]);
  requiredOneOf(["CLOUDINARY_API_KEY"]);
  requiredOneOf(["CLOUDINARY_API_SECRET"]);

  // Payment gateway
  requiredOneOf(["RAZORPAY_KEY_ID"]);
  requiredOneOf(["RAZORPAY_KEY_SECRET"]);
  requiredOneOf(["RAZORPAY_WEBHOOK_SECRET"]);
  requiredOneOf(["BREVO_API_KEY"]);
  requiredOneOf(["BREVO_FROM_EMAIL"]);
    const appEnv = String(process.env.APP_ENV || "production").toLowerCase();
  const razorpayKeyId = String(process.env.RAZORPAY_KEY_ID || "");

  if (!["alpha", "production"].includes(appEnv)) {
    throw new Error("Invalid APP_ENV: expected alpha or production.");
  }

  if (appEnv === "alpha" && !/^rzp_test_/.test(razorpayKeyId)) {
    throw new Error("Alpha must use Razorpay TEST credentials.");
  }

  if (appEnv === "production" && !/^rzp_live_/.test(razorpayKeyId)) {
    throw new Error("Production must use Razorpay LIVE credentials.");
  }
};

module.exports = {
  DEFAULT_PRODUCTION_FRONTEND_URL,
  LEGACY_PRODUCTION_FRONTEND_URL,
  validateEnvironment,
};

